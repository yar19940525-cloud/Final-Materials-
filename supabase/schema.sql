-- 시험지 변환 사이트 데이터베이스 (Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run)
-- 여러 번 실행해도 안전하게 만들었습니다.

-- ────────────────────────────────────────────────
-- 1) 사용자(로그인한 사람) 목록 + 승인 상태
-- ────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text,
  avatar_url  text,
  role        text not null default 'user'    check (role   in ('user', 'admin')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  last_seen_at timestamptz
);

-- ────────────────────────────────────────────────
-- 2) 사용 기록: 작업 1건(변환 1번, 예상문제 1번 …)당 한 줄
-- ────────────────────────────────────────────────
create table if not exists public.usage_logs (
  id                 bigint generated always as identity primary key,
  job_id             uuid not null unique,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  feature            text not null,            -- convert / predict-jikbo / predict-hakpeu / dialogue / analysis / analysis-sms / cheer
  label              text,                     -- 문서 이름(들)
  files              jsonb not null default '[]'::jsonb,  -- [{name,size,type,key}] key = 클라우드플레어 R2 저장 위치
  file_count         int    not null default 0,
  file_bytes         bigint not null default 0,
  request_count      int    not null default 0, -- AI 호출 횟수
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd           numeric(12, 6) not null default 0, -- 추정 요금(달러)
  status             text not null default 'running' check (status in ('running', 'done', 'failed')),
  error              text,
  result_key         text,                     -- 결과물이 저장된 R2 위치
  created_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create index if not exists usage_logs_user_created_idx on public.usage_logs (user_id, created_at desc);
create index if not exists usage_logs_created_idx      on public.usage_logs (created_at desc);

-- ────────────────────────────────────────────────
-- 3) 보안: 브라우저(anon/로그인 사용자)는 이 표들을 직접 읽거나 쓸 수 없고,
--    우리 서버(service_role 키)만 접근합니다.
-- ────────────────────────────────────────────────
alter table public.profiles   enable row level security;
alter table public.usage_logs enable row level security;
-- (정책을 하나도 만들지 않으므로 anon·authenticated 는 전부 거부됩니다)

-- ────────────────────────────────────────────────
-- 4) 구글 로그인하면 자동으로 "승인 대기" 사용자 한 줄 만들기
-- ────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────
-- 5) 사용 기록 함수 (서버가 호출). 같은 job_id는 한 줄에 합산됩니다.
-- ────────────────────────────────────────────────
create or replace function public.start_job(
  p_job_id uuid, p_user_id uuid, p_feature text, p_label text,
  p_files jsonb, p_count int, p_bytes bigint
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usage_logs (job_id, user_id, feature, label, files, file_count, file_bytes)
  values (p_job_id, p_user_id, p_feature, p_label, coalesce(p_files, '[]'::jsonb), p_count, p_bytes)
  on conflict (job_id) do update
    set label = excluded.label, files = excluded.files,
        file_count = excluded.file_count, file_bytes = excluded.file_bytes
    where public.usage_logs.user_id = excluded.user_id;
end;
$$;

create or replace function public.log_usage(
  p_job_id uuid, p_user_id uuid, p_feature text,
  p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint,
  p_cost numeric, p_error text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usage_logs
    (job_id, user_id, feature, request_count, input_tokens, output_tokens,
     cache_read_tokens, cache_write_tokens, cost_usd, error)
  values
    (p_job_id, p_user_id, p_feature, 1, p_input, p_output, p_cache_read, p_cache_write, p_cost, p_error)
  on conflict (job_id) do update
    set request_count      = public.usage_logs.request_count + 1,
        input_tokens       = public.usage_logs.input_tokens + excluded.input_tokens,
        output_tokens      = public.usage_logs.output_tokens + excluded.output_tokens,
        cache_read_tokens  = public.usage_logs.cache_read_tokens + excluded.cache_read_tokens,
        cache_write_tokens = public.usage_logs.cache_write_tokens + excluded.cache_write_tokens,
        cost_usd           = public.usage_logs.cost_usd + excluded.cost_usd,
        error              = coalesce(excluded.error, public.usage_logs.error)
    where public.usage_logs.user_id = excluded.user_id;
end;
$$;

create or replace function public.finish_job(
  p_job_id uuid, p_user_id uuid, p_feature text,
  p_status text, p_error text, p_result_key text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.usage_logs (job_id, user_id, feature, status, error, result_key, finished_at)
  values (p_job_id, p_user_id, p_feature, p_status, p_error, p_result_key, now())
  on conflict (job_id) do update
    set status = excluded.status,
        error = coalesce(excluded.error, public.usage_logs.error),
        result_key = coalesce(excluded.result_key, public.usage_logs.result_key),
        finished_at = now()
    where public.usage_logs.user_id = excluded.user_id;
end;
$$;

-- 함수는 서버(service_role)만 실행할 수 있게
revoke all on function public.start_job(uuid, uuid, text, text, jsonb, int, bigint) from public, anon, authenticated;
revoke all on function public.log_usage(uuid, uuid, text, bigint, bigint, bigint, bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.finish_job(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.start_job(uuid, uuid, text, text, jsonb, int, bigint) to service_role;
grant execute on function public.log_usage(uuid, uuid, text, bigint, bigint, bigint, bigint, numeric, text) to service_role;
grant execute on function public.finish_job(uuid, uuid, text, text, text, text) to service_role;

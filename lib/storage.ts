// 서버 전용: 클라우드플레어 R2 저장소 (올린 문서·결과물 보관). 바인딩 이름은 FILES (wrangler.jsonc).
// 저장소가 없으면(로컬 개발) null을 돌려주고, 호출하는 쪽은 저장을 건너뛴다.

export interface StoredObject {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}
export interface BucketLike {
  put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<StoredObject | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
}

// 테스트 전용 메모리 저장소 (환경 변수 STORAGE_MODE=memory 일 때만)
function memoryBucket(): BucketLike {
  const g = globalThis as unknown as { __memBucket?: Map<string, { data: ArrayBuffer; type?: string }> };
  const m = (g.__memBucket ??= new Map());
  return {
    async put(key, value, o) {
      const data = typeof value === "string" ? new TextEncoder().encode(value).buffer : value;
      m.set(key, { data: data as ArrayBuffer, type: o?.httpMetadata?.contentType });
    },
    async get(key) {
      const v = m.get(key);
      if (!v) return null;
      return { body: new Blob([v.data]).stream(), size: v.data.byteLength, httpMetadata: { contentType: v.type } };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) m.delete(k);
    },
    async list({ prefix }) {
      const objects = [...m.entries()].filter(([k]) => !prefix || k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.data.byteLength }));
      return { objects, truncated: false };
    },
  };
}

export async function getBucket(): Promise<BucketLike | null> {
  if (process.env.STORAGE_MODE === "memory") return memoryBucket();
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as { FILES?: BucketLike };
    return env.FILES ?? null;
  } catch {
    return null; // Cloudflare 밖에서 실행 중 (로컬 개발 등)
  }
}

// R2 키에 쓸 안전한 파일 이름 (경로 문자·제어 문자 제거, 길이 제한, 확장자 유지)
export function safeName(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim() || "file";
  if (base.length <= 80) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 8 ? base.slice(dot) : "";
  return base.slice(0, 80 - ext.length) + ext;
}

// 접두사 아래의 파일을 모두 지운다 (사용자·작업 삭제용). 지운 개수를 돌려준다.
export async function deletePrefix(bucket: BucketLike, prefix: string): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 500 });
    if (page.objects.length) {
      await bucket.delete(page.objects.map((o) => o.key));
      n += page.objects.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}

// 서버 공용: 오류와 응답 도우미
export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
export const fail = (error: string, status: number) => Response.json({ error }, { status });

// 라우트 본문을 감싸 HttpError를 JSON 오류 응답으로 바꾼다.
export async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HttpError) return fail(e.message, e.status);
    console.error(e);
    return fail("요청을 처리하지 못했어요.", 500);
  }
}

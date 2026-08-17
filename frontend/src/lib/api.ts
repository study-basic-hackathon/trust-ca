export const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

export type ApiResult<T> = { data: T } | { error: { code: string; message: string } };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Thin fetch wrapper for backend calls from Client Components. Never calls
 * Server Actions or Next.js API routes — the browser talks to backend/ directly.
 */
export async function api<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as ApiResult<T>;
  if (!response.ok || "error" in body) {
    if ("error" in body) throw new ApiError(body.error.code, body.error.message);
    throw new ApiError("UNKNOWN_ERROR", "API処理に失敗しました。");
  }
  return body.data;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");

  const response = await fetch(input, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const code = typeof body?.error === "string" ? body.error : `HTTP_${response.status}`;
    throw new ApiError(response.status, code);
  }

  return response.json() as Promise<T>;
}

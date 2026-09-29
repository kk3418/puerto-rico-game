export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    params?: Record<string, string | number>;
  };
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? res.statusText, data.code, data.params);
  }
  return data as T;
}

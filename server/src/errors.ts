export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

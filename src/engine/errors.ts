export type EngineErrorCode = "ILLEGAL_ACTION" | "UNKNOWN_ROLE";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

export function applyFailureDetail(err: unknown): string {
  if (err instanceof EngineError) return err.code;
  return "APPLY_FAILED";
}

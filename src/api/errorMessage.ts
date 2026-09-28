import { ApiError } from "./client";
import i18n from "../i18n";

export function formatApiError(err: unknown, fallback?: string): string {
  if (err instanceof ApiError && err.code) {
    const key = `errors.${err.code}`;
    if (i18n.exists(key)) {
      return i18n.t(key, err.params);
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback ?? i18n.t("serverUnreachable");
}

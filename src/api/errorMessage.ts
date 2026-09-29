import { ApiError } from "./client";
import i18n from "../i18n";

export function formatApiError(err: unknown, fallback?: string): string {
  if (err instanceof ApiError && err.code) {
    const params: Record<string, string | number> = { ...err.params };
    if (typeof params.detail === "string") {
      const detailKey = `errors.details.${params.detail}`;
      if (i18n.exists(detailKey)) {
        params.detail = i18n.t(detailKey);
      }
    }
    if (err.code === "INVALID_REQUEST") {
      if (typeof params.detail === "string" && params.detail) {
        return i18n.t("errors.INVALID_REQUEST_DETAIL", params);
      }
      return i18n.t("errors.INVALID_REQUEST");
    }
    const key = `errors.${err.code}`;
    if (i18n.exists(key)) {
      return i18n.t(key, params);
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback ?? i18n.t("serverUnreachable");
}

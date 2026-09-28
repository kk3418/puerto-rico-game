import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { formatApiError } from "./errorMessage";
import i18n, { i18nReady } from "../i18n";

describe("formatApiError", () => {
  beforeAll(async () => {
    await i18nReady;
    await i18n.changeLanguage("en");
  });

  it("translates known API error codes", () => {
    const err = new ApiError(400, "事件 6 無法套用：boom", "EVENT_APPLY_FAILED", {
      seq: 6,
      detail: "boom",
    });
    expect(formatApiError(err)).toBe("Event 6 could not be applied: boom");
  });

  it("falls back to the raw message when the code is unknown", () => {
    expect(formatApiError(new ApiError(500, "raw server text", "NOPE"))).toBe("raw server text");
  });
});

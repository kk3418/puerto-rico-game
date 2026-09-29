import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { formatApiError } from "./errorMessage";
import i18n, { i18nReady } from "../i18n";

describe("formatApiError", () => {
  beforeAll(async () => {
    await i18nReady;
    await i18n.changeLanguage("en");
  });

  it("translates EVENT_APPLY_FAILED detail codes", () => {
    const err = new ApiError(400, "事件 6 無法套用：ILLEGAL_ACTION", "EVENT_APPLY_FAILED", {
      seq: 6,
      detail: "ILLEGAL_ACTION",
    });
    expect(formatApiError(err)).toBe("Event 6 could not be applied: illegal action");
  });

  it("translates nickname validation codes", () => {
    expect(formatApiError(new ApiError(400, "NICKNAME_REQUIRED", "NICKNAME_REQUIRED"))).toBe(
      "Please enter a nickname",
    );
    expect(formatApiError(new ApiError(400, "NICKNAME_TOO_LONG", "NICKNAME_TOO_LONG"))).toBe(
      "Nickname is too long",
    );
  });

  it("surfaces INVALID_REQUEST detail when present", () => {
    expect(
      formatApiError(new ApiError(400, "raw zod", "INVALID_REQUEST", { detail: "Expected number" })),
    ).toBe("Invalid request: Expected number");
  });

  it("falls back to the raw message when the code is unknown", () => {
    expect(formatApiError(new ApiError(500, "raw server text", "NOPE"))).toBe("raw server text");
  });

  it("translates apply detail codes in zh-Hant", async () => {
    await i18n.changeLanguage("zh-Hant");
    expect(
      formatApiError(
        new ApiError(400, "事件 6 無法套用：ILLEGAL_ACTION", "EVENT_APPLY_FAILED", {
          seq: 6,
          detail: "ILLEGAL_ACTION",
        }),
      ),
    ).toBe("事件 6 無法套用：非法行動");
    await i18n.changeLanguage("en");
  });
});

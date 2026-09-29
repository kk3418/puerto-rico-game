import { describe, expect, it } from "vitest";
import { resolveAppLanguage } from "./index";

describe("resolveAppLanguage", () => {
  it("maps any Chinese locale to zh-Hant", () => {
    expect(resolveAppLanguage("zh")).toBe("zh-Hant");
    expect(resolveAppLanguage("zh-TW")).toBe("zh-Hant");
    expect(resolveAppLanguage("zh-Hant")).toBe("zh-Hant");
    expect(resolveAppLanguage("zh-CN")).toBe("zh-Hant");
  });

  it("falls back to English for everything else", () => {
    expect(resolveAppLanguage("en")).toBe("en");
    expect(resolveAppLanguage("en-US")).toBe("en");
    expect(resolveAppLanguage("ja")).toBe("en");
    expect(resolveAppLanguage("de-DE")).toBe("en");
  });
});

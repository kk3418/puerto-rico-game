import { describe, expect, it } from "vitest";
import enCommon from "./locales/en/common.json";
import enGame from "./locales/en/game.json";
import enLog from "./locales/en/log.json";
import enTerms from "./locales/en/terms.json";
import zhCommon from "./locales/zh-Hant/common.json";
import zhGame from "./locales/zh-Hant/game.json";
import zhLog from "./locales/zh-Hant/log.json";
import zhTerms from "./locales/zh-Hant/terms.json";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      return flatten(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe("locale key parity", () => {
  it.each([
    ["common", enCommon, zhCommon],
    ["game", enGame, zhGame],
    ["log", enLog, zhLog],
    ["terms", enTerms, zhTerms],
  ] as const)("keeps en and zh-Hant %s keys aligned", (_ns, en, zh) => {
    expect(flatten(en as Record<string, unknown>).sort()).toEqual(
      flatten(zh as Record<string, unknown>).sort(),
    );
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import i18n, { i18nReady } from "./index";
import { formatEndReason, formatLogEntry } from "./format";

describe("formatLogEntry", () => {
  beforeAll(async () => {
    await i18nReady;
  });

  it("returns stored text when a key is missing (old saves)", () => {
    expect(formatLogEntry({ id: 1, text: "第 1 輪開始。" }, i18n.t)).toBe("第 1 輪開始。");
  });

  it("translates structured keys with term ids", async () => {
    await i18n.changeLanguage("en");
    expect(
      formatLogEntry({ id: 2, key: "built", params: { player: "Ada", cost: 3, building: "largeIndigo" } }, i18n.t),
    ).toBe("Ada spent 3 doubloons to build the Indigo Plant.");
    await i18n.changeLanguage("zh-Hant");
    expect(
      formatLogEntry({ id: 2, key: "built", params: { player: "Ada", cost: 3, building: "largeIndigo" } }, i18n.t),
    ).toBe("Ada花費 3 金幣建造大型靛藍廠。");
  });
});

describe("formatEndReason", () => {
  beforeAll(async () => {
    await i18nReady;
    await i18n.changeLanguage("en");
  });

  it("translates known keys and leaves unknown Chinese as-is", () => {
    expect(formatEndReason("vpExhausted", i18n.t)).toBe("the victory point chips have run out");
    expect(formatEndReason("cityFull:Ada", i18n.t)).toBe("Ada's city is full");
    expect(formatEndReason("勝利分籌碼用盡", i18n.t)).toBe("勝利分籌碼用盡");
  });
});

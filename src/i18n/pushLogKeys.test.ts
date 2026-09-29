import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import enLog from "./locales/en/log.json";
import zhLog from "./locales/zh-Hant/log.json";

const ENGINE_ROOT = join(process.cwd(), "src/engine");

function collectPushLogKeys(dir: string): string[] {
  const keys = new Set<string>();
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) {
      for (const key of collectPushLogKeys(path)) keys.add(key);
      continue;
    }
    if (!name.name.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/pushLog\(\s*[^,]+,\s*"([^"]+)"/g)) {
      keys.add(match[1]!);
    }
  }
  return [...keys].sort();
}

describe("pushLog key catalog", () => {
  it("resolves every engine pushLog key in both locales", () => {
    const keys = collectPushLogKeys(ENGINE_ROOT);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(enLog, key).toHaveProperty(key);
      expect(zhLog, key).toHaveProperty(key);
    }
  });
});

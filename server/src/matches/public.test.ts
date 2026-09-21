import { describe, expect, it } from "vitest";
import { canReadMatchSave, publicSeed } from "./public";

describe("publicSeed", () => {
  it("returns the seed for solo and hides it otherwise", () => {
    expect(publicSeed("solo", 42)).toBe(42);
    expect(publicSeed("online", 42)).toBeNull();
  });
});

describe("canReadMatchSave", () => {
  it("allows solo caches and blocks saves that still need consent", () => {
    expect(canReadMatchSave({ consentRequired: false })).toBe(true);
    expect(canReadMatchSave({ consentRequired: true })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { canAccessMatch } from "./access";

describe("canAccessMatch", () => {
  const match = {
    participants: [
      { userId: "u1", guestId: "g1", isHuman: true },
      { userId: null, guestId: null, isHuman: false },
    ],
  };

  it("allows the bound user or the original guest", () => {
    expect(canAccessMatch(match, { userId: "u1" })).toBe(true);
    expect(canAccessMatch(match, { guestId: "g1" })).toBe(true);
    expect(canAccessMatch(match, { userId: "u1", guestId: "g1" })).toBe(true);
  });

  it("rejects a different identity", () => {
    expect(canAccessMatch(match, { userId: "u2" })).toBe(false);
    expect(canAccessMatch(match, { guestId: "g2" })).toBe(false);
    expect(canAccessMatch(match, {})).toBe(false);
  });
});

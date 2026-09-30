import { describe, expect, it } from "vitest";
import { canReadMatchSave, publicSeed } from "./public";

describe("publicSeed", () => {
  it("returns the seed for solo and hides it otherwise", () => {
    expect(publicSeed("solo", 42)).toBe(42);
    expect(publicSeed("online", 42)).toBeNull();
  });
});

describe("canReadMatchSave", () => {
  const participants = [
    { seatIndex: 0, isHuman: true },
    { seatIndex: 1, isHuman: true },
    { seatIndex: 2, isHuman: false },
  ];

  it("allows solo caches and blocks saves that still need consent", () => {
    expect(canReadMatchSave({ mode: "solo", save: { consentRequired: false }, participants, consents: [] })).toBe(true);
    expect(canReadMatchSave({ mode: "solo", save: { consentRequired: true }, participants, consents: [] })).toBe(false);
    expect(canReadMatchSave({ mode: "solo", save: null, participants, consents: [] })).toBe(true);
  });

  it("gates online saves on every human seat consenting", () => {
    expect(canReadMatchSave({ mode: "online", save: null, participants, consents: [] })).toBe(false);
    expect(canReadMatchSave({ mode: "online", save: null, participants, consents: [{ seatIndex: 0 }] })).toBe(false);
    expect(
      canReadMatchSave({
        mode: "online",
        save: { consentRequired: true },
        participants,
        consents: [{ seatIndex: 0 }, { seatIndex: 1 }],
      }),
    ).toBe(true);
  });
});

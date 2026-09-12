import { describe, expect, it } from "vitest";
import { canMergeByEmail, decideAccountMerge } from "./accounts";

describe("account merge", () => {
  it("reuses the existing provider binding", () => {
    expect(
      decideAccountMerge({
        providerUserId: "u1",
        emailOwnerUserId: "u2",
        email: "a@example.com",
        emailVerified: true,
      }),
    ).toBe("existing-provider");
  });

  it("merges onto a verified email owner when the provider is new", () => {
    expect(
      decideAccountMerge({
        providerUserId: null,
        emailOwnerUserId: "u2",
        email: "a@example.com",
        emailVerified: true,
      }),
    ).toBe("merge-email");
  });

  it("does not merge GitHub (or any provider) without a verified email", () => {
    expect(canMergeByEmail(null, false)).toBe(false);
    expect(canMergeByEmail("hidden@example.com", false)).toBe(false);
    expect(
      decideAccountMerge({
        providerUserId: null,
        emailOwnerUserId: "u2",
        email: "hidden@example.com",
        emailVerified: false,
      }),
    ).toBe("create");
  });

  it("creates a user when nothing matches", () => {
    expect(
      decideAccountMerge({
        providerUserId: null,
        emailOwnerUserId: null,
        email: "new@example.com",
        emailVerified: true,
      }),
    ).toBe("create");
  });
});

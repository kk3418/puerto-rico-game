import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { nicknameSchema, NICKNAME_REQUIRED, NICKNAME_TOO_LONG, ZOD_MESSAGE_CODES } from "./validation";

describe("nicknameSchema", () => {
  it("accepts trimmed nicknames within length", () => {
    expect(nicknameSchema.parse("  Ada  ")).toBe("Ada");
  });

  it("rejects blank and oversized nicknames with stable codes", () => {
    try {
      nicknameSchema.parse("   ");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const message = (err as ZodError).issues[0]?.message;
      expect(message).toBe(NICKNAME_REQUIRED);
      expect(ZOD_MESSAGE_CODES.has(message!)).toBe(true);
    }

    try {
      nicknameSchema.parse("x".repeat(25));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const message = (err as ZodError).issues[0]?.message;
      expect(message).toBe(NICKNAME_TOO_LONG);
      expect(ZOD_MESSAGE_CODES.has(message!)).toBe(true);
    }
  });
});

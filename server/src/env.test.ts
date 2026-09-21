import { describe, expect, it } from "vitest";
import { envSchema } from "./env";

function parseSecret(secret: string) {
  return envSchema.safeParse({
    DATABASE_URL: "postgresql://puerto:puerto@localhost:5432/puerto_rico",
    SESSION_SECRET: secret,
  });
}

describe("SESSION_SECRET", () => {
  it("accepts a 32-character random secret", () => {
    const secret = "a".repeat(32);
    expect(parseSecret(secret).success).toBe(true);
  });

  it("rejects secrets shorter than 32 characters", () => {
    const result = parseSecret("short-secret");
    expect(result.success).toBe(false);
  });

  it("rejects committed placeholders even when they are long enough", () => {
    expect(parseSecret("REPLACE_WITH_OPENSSL_RAND_HEX_32").success).toBe(false);
    expect(parseSecret("change-me-to-a-long-random-string").success).toBe(false);
    expect(parseSecret("dev-only-not-for-production-session-secret").success).toBe(false);
    expect(parseSecret("test-session-secret-not-for-production-use").success).toBe(false);
  });
});

import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

// quiet: hosted environments inject real env vars and have no .env to report on.
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const SESSION_SECRET_PLACEHOLDERS = new Set([
  "REPLACE_WITH_OPENSSL_RAND_HEX_32",
  "change-me-to-a-long-random-string",
  "dev-only-not-for-production-session-secret",
  "test-session-secret-not-for-production-use",
]);

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters")
    .refine(
      (value) => !SESSION_SECRET_PLACEHOLDERS.has(value),
      "SESSION_SECRET looks like a committed placeholder; generate one with openssl rand -hex 32",
    ),
  PORT: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") return 3001;
      return Number(value);
    })
    .pipe(z.number().int().positive()),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);

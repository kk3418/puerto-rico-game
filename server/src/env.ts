import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(8),
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

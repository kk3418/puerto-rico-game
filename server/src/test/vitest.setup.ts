import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

const fallback = "postgresql://puerto:puerto@localhost:5432/puerto_rico";
const current = process.env.DATABASE_URL ?? fallback;
process.env.DATABASE_URL = current.includes("schema=itest")
  ? current
  : current.includes("?")
    ? `${current}&schema=itest`
    : `${current}?schema=itest`;
process.env.SESSION_SECRET ||= "test-session-secret";
process.env.NODE_ENV = "test";

import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

const fallback = "postgresql://puerto:puerto@localhost:5432/puerto_rico";
const current = process.env.DATABASE_URL ?? fallback;
// Parallel test files share one Postgres; give each worker its own schema so
// truncations in one file cannot wipe another file's sessions mid-test.
const poolId = process.env.VITEST_POOL_ID ?? "1";
const url = new URL(current);
url.searchParams.set("schema", `itest_${poolId}`);
process.env.DATABASE_URL = url.toString();
process.env.SESSION_SECRET = "vitest-local-session-secret-min-32-chars";
process.env.NODE_ENV = "test";

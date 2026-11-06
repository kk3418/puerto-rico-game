import { execSync, spawn } from "node:child_process";
import http from "node:http";
import { PrismaClient } from "@prisma/client";
import { e2eDatabaseUrl } from "./database-url";

const databaseUrl = e2eDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;
process.env.PORT = "3099";
process.env.CLIENT_ORIGIN = "http://127.0.0.1:5179";
process.env.NODE_ENV = "development";
process.env.VITE_PORT = "5179";
process.env.VITE_API_PORT = "3099";

const adminUrl = new URL(databaseUrl);
adminUrl.searchParams.delete("schema");
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS e2e`);
await admin.$disconnect();

execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

const { createApp } = await import("../server/src/app");
const { attachGameServer } = await import("../server/src/live/gameServer");

const server = http.createServer(createApp());
attachGameServer(server);
await new Promise<void>((resolve) => {
  server.listen(3099, "127.0.0.1", () => resolve());
});

const vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5179", "--strictPort"], {
  stdio: "inherit",
  env: process.env,
});

function shutdown() {
  vite.kill("SIGTERM");
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
vite.on("exit", (code) => {
  if (code !== 0 && code !== null) process.exit(code);
});

import { createApp } from "./app";
import { prisma } from "./db";
import { env } from "./env";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://127.0.0.1:${env.PORT}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

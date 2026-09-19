import { createApp } from "./app";
import { prisma } from "./db";
import { env } from "./env";

const app = createApp();

// 0.0.0.0 is required by hosts that health-check the container over IPv4.
const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`API listening on 0.0.0.0:${env.PORT}`);
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

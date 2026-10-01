import http from "node:http";
import { createApp } from "./app";
import { prisma } from "./db";
import { env } from "./env";
import { attachGameServer } from "./live/gameServer";

const app = createApp();
const server = http.createServer(app);
const io = attachGameServer(server);

// 0.0.0.0 is required by hosts that health-check the container over IPv4.
server.listen(env.PORT, "0.0.0.0", () => {
  console.log(`API listening on 0.0.0.0:${env.PORT}`);
});

async function shutdown() {
  io.close();
  server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { authRouter } from "./auth/routes";
import { env } from "./env";
import { HttpError } from "./errors";
import { matchesRouter, meRouter } from "./matches/routes";
import { sessionMiddleware } from "./session";
import { ZOD_MESSAGE_CODES } from "./validation";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/matches", matchesRouter);
  app.use("/api/me", meRouter);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const message = first?.message ?? "請求無效";
      if (ZOD_MESSAGE_CODES.has(message)) {
        res.status(400).json({ error: message, code: message });
        return;
      }
      res.status(400).json({
        error: message,
        code: "INVALID_REQUEST",
        params: { detail: message },
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.params ? { params: err.params } : {}),
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "伺服器錯誤", code: "SERVER_ERROR" });
  };
  app.use(errorHandler);

  return app;
}

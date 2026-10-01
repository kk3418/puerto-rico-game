import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { Session, SessionData } from "express-session";
import { Server, type Socket } from "socket.io";
import { getLegalActions, type Action } from "../../../src/engine";
import { prisma } from "../db";
import { env } from "../env";
import { HttpError } from "../errors";
import type { SessionIdentity } from "../identity";
import { isAction } from "../matches/replay";
import { sessionMiddleware } from "../session";
import { applyLiveAction, getLiveState } from "./liveMatches";
import { redactStateForClient, type RedactedGameState } from "./redact";

type SessionRequest = IncomingMessage & { session?: Session & SessionData };

export type LiveStateView = {
  matchId: string;
  state: RedactedGameState;
  legalActions: Action[];
  eventCount: number;
};

function roomName(matchId: string): string {
  return `match:${matchId}`;
}

let gameIo: Server | null = null;

function emitGameError(socket: Socket, err: unknown): void {
  if (err instanceof HttpError) {
    socket.emit("game:error", {
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.params ? { params: err.params } : {}),
    });
    return;
  }
  console.error(err);
  socket.emit("game:error", { error: "伺服器錯誤", code: "SERVER_ERROR" });
}

function payloadMatchId(payload: unknown): string {
  const matchId = (payload as { matchId?: unknown } | undefined)?.matchId;
  if (typeof matchId !== "string" || !matchId) {
    throw new HttpError(400, "缺少對局 id", "MISSING_MATCH_ID");
  }
  return matchId;
}

async function seatFor(matchId: string, identity: SessionIdentity) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: true },
  });
  if (!match || match.mode !== "online") {
    throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");
  }
  if (match.status !== "playing") {
    throw new HttpError(409, "對局已結束，無法再寫入", "MATCH_NOT_PLAYING");
  }
  const seat =
    match.participants.find((p) => identity.userId && p.userId === identity.userId) ??
    match.participants.find((p) => identity.guestId && p.guestId === identity.guestId);
  if (!seat) {
    throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
  }
  return seat;
}

async function liveView(matchId: string): Promise<LiveStateView> {
  const live = await getLiveState(matchId);
  return {
    matchId,
    state: redactStateForClient(live.state),
    legalActions: getLegalActions(live.state),
    eventCount: live.eventCount,
  };
}

export function broadcastMatchAbandoned(matchId: string): void {
  gameIo?.to(roomName(matchId)).emit("game:over", { matchId, status: "abandoned" });
}

export function attachGameServer(server: HttpServer): Server {
  const sessionMw = sessionMiddleware();
  const io = new Server(server, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });
  io.engine.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    sessionMw(req as unknown as Request, res as unknown as Response, next as NextFunction);
  });

  io.use((socket, next) => {
    const session = (socket.request as SessionRequest).session;
    const userId = session?.userId;
    const guestId = session?.guestId;
    if (!userId && !guestId) {
      const err = new Error("AUTH_REQUIRED") as Error & { data?: { code: string } };
      err.data = { code: "AUTH_REQUIRED" };
      next(err);
      return;
    }
    const identity: SessionIdentity = {};
    if (userId) identity.userId = userId;
    if (guestId) identity.guestId = guestId;
    socket.data.identity = identity;
    next();
  });

  io.on("connection", (socket) => {
    const identity = socket.data.identity as SessionIdentity;

    socket.on("game:watch", async (payload: unknown) => {
      try {
        const matchId = payloadMatchId(payload);
        const seat = await seatFor(matchId, identity);
        await socket.join(roomName(matchId));
        const view = await liveView(matchId);
        socket.emit("game:state", { ...view, seatIndex: seat.seatIndex });
      } catch (err) {
        emitGameError(socket, err);
      }
    });

    socket.on("game:action", async (payload: unknown) => {
      try {
        const matchId = payloadMatchId(payload);
        const action = (payload as { action?: unknown } | undefined)?.action;
        if (!isAction(action)) {
          throw new HttpError(400, "行動格式無效", "EVENT_ACTION_INVALID");
        }
        const result = await applyLiveAction({ matchId, identity, action });
        await socket.join(roomName(matchId));
        io.to(roomName(matchId)).emit("game:state", {
          matchId,
          state: redactStateForClient(result.state),
          legalActions: result.legalActions,
          eventCount: result.eventCount,
        });
        if (result.finish) {
          io.to(roomName(matchId)).emit("game:over", {
            matchId,
            status: "finished",
            scores: result.finish.scores,
            endReason: result.finish.endReason,
          });
        }
      } catch (err) {
        emitGameError(socket, err);
      }
    });
  });

  gameIo = io;
  return io;
}

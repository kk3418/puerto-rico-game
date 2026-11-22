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
import {
  broadcastMatchOver,
  broadcastMatchState,
  roomName,
  setGameIo,
} from "./liveBroadcast";
import { applyLiveAction, getLiveState } from "./liveMatches";
import { ensureRuntime, getOpenVoteView } from "./matchRuntime";
import { redactStateForClient, type RedactedGameState } from "./redact";
import type { VoteView } from "./types";

type SessionRequest = IncomingMessage & { session?: Session & SessionData };

export type LiveStateView = {
  matchId: string;
  state: RedactedGameState;
  legalActions: Action[];
  eventCount: number;
  vote: VoteView | null;
};

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
  const seat = identity.userId
    ? match.participants.find(
        (participant) => participant.userId === identity.userId && participant.isHuman && !participant.isAi,
      )
    : undefined;
  if (!seat) {
    throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
  }
  return seat;
}

async function liveView(matchId: string): Promise<LiveStateView> {
  const [live, vote] = await Promise.all([getLiveState(matchId), getOpenVoteView(matchId)]);
  return {
    matchId,
    state: redactStateForClient(live.state),
    legalActions: getLegalActions(live.state),
    eventCount: live.eventCount,
    vote,
  };
}

export function broadcastMatchAbandoned(matchId: string): void {
  broadcastMatchOver(matchId, { matchId, status: "abandoned" });
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
    if (!userId) {
      const err = new Error("LOGIN_REQUIRED") as Error & { data?: { code: string } };
      err.data = { code: "LOGIN_REQUIRED" };
      next(err);
      return;
    }
    const identity: SessionIdentity = { userId };
    socket.data.identity = identity;
    next();
  });

  io.on("connection", (socket) => {
    const identity = socket.data.identity as SessionIdentity;

    socket.on("game:watch", async (payload: unknown) => {
      try {
        const matchId = payloadMatchId(payload);
        const seat = await seatFor(matchId, identity);
        await ensureRuntime(matchId);
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
        broadcastMatchState(matchId, {
          state: redactStateForClient(result.state),
          legalActions: result.legalActions,
          eventCount: result.eventCount,
          vote: null,
        });
        if (result.finish) {
          broadcastMatchOver(matchId, {
            matchId,
            status: "finished",
            scores: result.finish.scores,
            endReason: result.finish.endReason,
          });
        }
        await ensureRuntime(matchId);
      } catch (err) {
        emitGameError(socket, err);
      }
    });
  });

  setGameIo(io);
  return io;
}

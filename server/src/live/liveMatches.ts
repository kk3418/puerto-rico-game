import { Prisma } from "@prisma/client";
import {
  applyAction,
  getActorIndex,
  getLegalActions,
  isLegalAction,
  isPlayerCount,
  type Action,
  type GameState,
} from "../../../src/engine";
import { prisma } from "../db";
import { HttpError } from "../errors";
import type { SessionIdentity } from "../identity";
import { finishMatch, type FinishResult } from "../matches/finish";
import { describeActionContext, isAction, replaySeatNames, replayStoredActions } from "../matches/replay";
import { replayCache } from "../matches/replayCache";

type LiveEntry = {
  state: GameState;
  eventCount: number;
};

const entries = new Map<string, LiveEntry>();
const pendingLoads = new Map<string, Promise<LiveEntry>>();
const locks = new Map<string, Promise<unknown>>();

export function withMatchLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
  const tail = locks.get(matchId) ?? Promise.resolve();
  const result = tail.then(fn);
  const stored = result.catch(() => {});
  locks.set(matchId, stored);
  void stored.then(() => {
    if (locks.get(matchId) === stored) locks.delete(matchId);
  });
  return result;
}

async function loadEntry(matchId: string): Promise<LiveEntry> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: { orderBy: { seatIndex: "asc" } }, _count: { select: { events: true } } },
  });
  if (!match) throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");
  if (!isPlayerCount(match.playerCount)) {
    throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
  }
  if (match.difficulty !== "balanced" && match.difficulty !== "aggressive") {
    throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
  }

  const events = await prisma.matchEvent.findMany({
    where: { matchId },
    orderBy: { seq: "asc" },
  });
  if (events.length !== match._count.events) {
    throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
  }
  const actions = events.map((event, index) => {
    if (event.seq !== index + 1 || !isAction(event.action)) {
      throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
    }
    return event.action;
  });

  const replayed = replayStoredActions({
    matchId,
    playerCount: match.playerCount,
    difficulty: match.difficulty,
    seed: match.seed,
    humanName: match.humanName,
    actions,
    seatNames: replaySeatNames(match),
  });
  if (!replayed.ok) {
    throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
  }
  return { state: replayed.state, eventCount: actions.length };
}

function getLiveEntry(matchId: string): Promise<LiveEntry> {
  const existing = entries.get(matchId);
  if (existing) return Promise.resolve(existing);
  const pending = pendingLoads.get(matchId);
  if (pending) return pending;
  const load = loadEntry(matchId).then(
    (entry) => {
      if (pendingLoads.get(matchId) === load) {
        pendingLoads.delete(matchId);
        entries.set(matchId, entry);
      }
      return entry;
    },
    (err: unknown) => {
      if (pendingLoads.get(matchId) === load) pendingLoads.delete(matchId);
      throw err;
    },
  );
  pendingLoads.set(matchId, load);
  return load;
}

export function dropLiveMatch(matchId: string): void {
  entries.delete(matchId);
  pendingLoads.delete(matchId);
}

export function clearLiveMatches(): void {
  entries.clear();
  pendingLoads.clear();
}

export async function getLiveState(matchId: string): Promise<{ state: GameState; eventCount: number }> {
  const entry = await getLiveEntry(matchId);
  return { state: entry.state, eventCount: entry.eventCount };
}

export type LiveActionResult = {
  matchId: string;
  state: GameState;
  legalActions: Action[];
  eventCount: number;
  gameOver: boolean;
  finish?: FinishResult;
};

export async function applyLiveAction(input: {
  matchId: string;
  identity: SessionIdentity;
  action: Action;
}): Promise<LiveActionResult> {
  return withMatchLock(input.matchId, async () => {
    const match = await prisma.match.findUnique({
      where: { id: input.matchId },
      include: { participants: true },
    });
    if (!match || match.mode !== "online") {
      throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");
    }
    if (match.status !== "playing") {
      throw new HttpError(409, "對局已結束，無法再寫入", "MATCH_NOT_PLAYING");
    }
    const seat =
      match.participants.find((p) => input.identity.userId && p.userId === input.identity.userId) ??
      match.participants.find((p) => input.identity.guestId && p.guestId === input.identity.guestId);
    if (!seat) {
      throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
    }

    const entry = await getLiveEntry(input.matchId);
    const actorSeatIndex = getActorIndex(entry.state);
    if (actorSeatIndex === null || actorSeatIndex !== seat.seatIndex) {
      throw new HttpError(409, "尚未輪到你行動", "NOT_YOUR_TURN");
    }
    const legal = getLegalActions(entry.state);
    if (!isLegalAction(entry.state, input.action, legal)) {
      throw new HttpError(400, "此行動目前不合法", "ILLEGAL_ACTION");
    }
    const meta = describeActionContext(entry.state);
    if (!meta) {
      throw new HttpError(409, "對局狀態無法對應行動者", "EVENT_NO_ACTOR");
    }

    const nextState = applyAction(entry.state, input.action);
    const seq = entry.eventCount + 1;
    try {
      await prisma.matchEvent.create({
        data: {
          matchId: input.matchId,
          seq,
          round: meta.round,
          phaseType: meta.phaseType,
          activeRole: meta.activeRole,
          actorSeatIndex: meta.actorSeatIndex,
          actorUserId: seat.userId ?? null,
          action: input.action as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        throw new HttpError(409, "事件序號衝突，請重試", "EVENT_SEQ_CONFLICT");
      }
      throw err;
    }

    entry.state = nextState;
    entry.eventCount = seq;
    replayCache.write(input.matchId, seq, nextState);

    const result: LiveActionResult = {
      matchId: input.matchId,
      state: nextState,
      legalActions: getLegalActions(nextState),
      eventCount: seq,
      gameOver: nextState.gameOver,
    };
    if (nextState.gameOver) {
      result.finish = await finishMatch(input.matchId);
      dropLiveMatch(input.matchId);
    }
    return result;
  });
}

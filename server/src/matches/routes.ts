import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { actionsEqual, applyAction, applyFailureDetail, getLegalActions, isPlayerCount, type Action } from "../../../src/engine";
import { nicknameSchema } from "../validation";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { requireIdentity, requireUser } from "../identity";
import { broadcastMatchAbandoned } from "../live/gameServer";
import { dropLiveMatch, getLiveState, withMatchLock } from "../live/liveMatches";
import { redactSavedStateForClient, redactStateForClient } from "../live/redact";
import { canAccessMatch } from "./access";
import { finishMatch } from "./finish";
import { canReadMatchSave, publicSeed } from "./public";
import { describeActionContext, isAction, isSupportedSaveSchema, replaySeatNames, replayStoredActions, SAVE_SCHEMA_VERSION } from "./replay";
import { replayCache } from "./replayCache";
import { classifySeq } from "./seq";

const playerCountSchema = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const difficultySchema = z.enum(["balanced", "aggressive"]);

const eventSchema = z.object({
  seq: z.number().int().positive(),
  action: z.unknown(),
  round: z.number().int().positive().optional(),
  phaseType: z.string().optional(),
  activeRole: z.string().nullable().optional(),
  actorSeatIndex: z.number().int().min(0).optional(),
  actorUserId: z.string().optional(),
});

function assertPlaying(status: string): void {
  if (status !== "playing") {
    throw new HttpError(409, "對局已結束，無法再寫入", "MATCH_NOT_PLAYING");
  }
}

function matchIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || !id) throw new HttpError(400, "缺少對局 id", "MISSING_MATCH_ID");
  return id;
}

async function loadOwnedMatch(matchId: string, identity: { userId?: string; guestId?: string }) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      participants: { orderBy: { seatIndex: "asc" } },
      save: true,
      saveConsents: true,
      _count: { select: { events: true } },
    },
  });
  if (!match) throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");
  if (!canAccessMatch(match, identity)) throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
  return match;
}

function matchSummary(match: {
  id: string;
  mode: string;
  playerCount: number;
  difficulty: string;
  seed: number;
  humanName: string;
  endReason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  verified: boolean;
  joinCode?: string | null;
  hostSeatIndex?: number;
  participants: Array<{
    seatIndex: number;
    nickname: string;
    userId: string | null;
    guestId: string | null;
    isHuman: boolean;
    isAi: boolean;
    vpChips: number | null;
    buildingVp: number | null;
    guildHall: number | null;
    residence: number | null;
    fortress: number | null;
    customsHouse: number | null;
    cityHall: number | null;
    total: number | null;
    goodsAndGold: number | null;
  }>;
  save: { matchId: string } | null;
  _count: { events: number };
}) {
  const online = match.mode === "online";
  return {
    id: match.id,
    mode: match.mode,
    playerCount: match.playerCount,
    difficulty: match.difficulty,
    seed: publicSeed(match.mode, match.seed),
    humanName: match.humanName,
    endReason: match.endReason,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    status: match.status,
    verified: match.verified,
    eventCount: match._count.events,
    hasSave: Boolean(match.save),
    joinCode: online ? (match.joinCode ?? null) : null,
    hostSeatIndex: online ? (match.hostSeatIndex ?? 0) : null,
    participants: match.participants.map((p) => ({
      seatIndex: p.seatIndex,
      nickname: p.nickname,
      userId: p.userId,
      guestId: p.guestId,
      isHuman: p.isHuman,
      isAi: p.isAi,
      scores:
        p.total === null
          ? null
          : {
              vpChips: p.vpChips ?? 0,
              buildingVp: p.buildingVp ?? 0,
              guildHall: p.guildHall ?? 0,
              residence: p.residence ?? 0,
              fortress: p.fortress ?? 0,
              customsHouse: p.customsHouse ?? 0,
              cityHall: p.cityHall ?? 0,
              total: p.total,
              goodsAndGold: p.goodsAndGold ?? 0,
            },
    })),
  };
}

export const matchesRouter = Router();

matchesRouter.post("/", async (req, res) => {
  const identity = requireIdentity(req);
  const body = z
    .object({
      nickname: nicknameSchema,
      playerCount: playerCountSchema,
      difficulty: difficultySchema,
      seed: z.number().int().min(0).max(0x7fffffff).optional(),
    })
    .parse(req.body);

  if (identity.guestId) {
    req.session.guestNickname = body.nickname;
  }

  const seed = body.seed ?? (Date.now() & 0x7fffffff);
  const participants: Prisma.MatchParticipantUncheckedCreateWithoutMatchInput[] = [];
  for (let i = 0; i < body.playerCount; i++) {
    const isHuman = i === 0;
    participants.push({
      seatIndex: i,
      nickname: isHuman ? body.nickname : `AI ${i}`,
      userId: isHuman ? identity.userId ?? null : null,
      guestId: isHuman ? identity.guestId ?? null : null,
      isHuman,
      isAi: !isHuman,
    });
  }

  if (participants[0] && !participants[0].userId && !participants[0].guestId) {
    throw new HttpError(401, "需要登入或訪客工作階段", "AUTH_REQUIRED");
  }

  const match = await prisma.match.create({
    data: {
      mode: "solo",
      playerCount: body.playerCount,
      difficulty: body.difficulty,
      seed,
      humanName: body.nickname,
      playToken: randomUUID(),
      participants: { create: participants },
    },
    include: { participants: { orderBy: { seatIndex: "asc" } }, save: true, _count: { select: { events: true } } },
  });

  res.status(201).json({ ...matchSummary(match), playToken: match.playToken });
});

matchesRouter.get("/:id", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  res.json(matchSummary(match));
});

matchesRouter.get("/:id/state", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  if (match.status !== "playing") {
    throw new HttpError(404, "無法找到該局遊戲", "MATCH_NOT_FOUND");
  }
  if (!isPlayerCount(match.playerCount)) {
    throw new HttpError(404, "無法找到該局遊戲", "MATCH_NOT_FOUND");
  }
  if (match.difficulty !== "balanced" && match.difficulty !== "aggressive") {
    throw new HttpError(404, "無法找到該局遊戲", "MATCH_NOT_FOUND");
  }

  if (match.mode === "online") {
    const seat =
      match.participants.find((p) => identity.userId && p.userId === identity.userId) ??
      match.participants.find((p) => identity.guestId && p.guestId === identity.guestId);
    if (!seat) throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
    const live = await getLiveState(match.id);
    res.json({
      ...matchSummary(match),
      state: redactStateForClient(live.state),
      legalActions: getLegalActions(live.state),
      seatIndex: seat.seatIndex,
    });
    return;
  }

  const events = await prisma.matchEvent.findMany({
    where: { matchId: match.id },
    orderBy: { seq: "asc" },
  });
  if (events.length !== match._count.events) {
    throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
  }
  const actions = events.map((event, index) => {
    if (event.seq !== index + 1) {
      throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
    }
    if (!isAction(event.action)) {
      throw new HttpError(409, "對局紀錄無法重放", "MATCH_REPLAY_FAILED");
    }
    return event.action;
  });

  const replayed = replayStoredActions({
    matchId: match.id,
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

  const claimed = await prisma.match.update({
    where: { id: match.id },
    data: { playToken: randomUUID() },
  });
  if (!claimed.playToken) {
    throw new HttpError(500, "無法鎖定對局", "MATCH_LOCK_FAILED");
  }

  res.json({ ...matchSummary(match), state: replayed.state, playToken: claimed.playToken });
});

matchesRouter.post("/:id/events", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  if (match.mode !== "solo") {
    throw new HttpError(409, "線上對局由伺服器處理行動，無法直接寫入事件", "MATCH_SERVER_AUTHORITATIVE");
  }
  assertPlaying(match.status);

  const body = z
    .object({
      playToken: z.string().min(1),
      events: z.array(eventSchema).min(1).max(200),
    })
    .parse(req.body);
  if (!match.playToken || body.playToken !== match.playToken) {
    throw new HttpError(409, "此對局已在另一個視窗進行，請重新整理", "PLAY_TOKEN_CONFLICT");
  }
  const incoming = [...body.events].sort((a, b) => a.seq - b.seq);
  const stored = await prisma.matchEvent.findMany({
    where: { matchId: match.id },
    orderBy: { seq: "asc" },
  });
  if (stored.length !== match._count.events) {
    throw new HttpError(409, "事件序號不完整", "EVENT_SEQ_INCOMPLETE");
  }
  for (let i = 0; i < stored.length; i++) {
    if (stored[i]!.seq !== i + 1) {
      throw new HttpError(409, "事件序號不完整", "EVENT_SEQ_INCOMPLETE");
    }
  }

  const bySeq = new Map(stored.map((event) => [event.seq, event]));
  let maxSeq = stored.length;
  const accepted: Array<{ seq: number; action: Action }> = [];

  for (const event of incoming) {
    if (!isAction(event.action)) {
      throw new HttpError(400, `事件 ${event.seq} 的 action 無效`, "EVENT_ACTION_INVALID", { seq: event.seq });
    }
    const kind = classifySeq(event.seq, maxSeq);
    if (kind === "gap") {
      throw new HttpError(409, `事件序號不連續（期望 ${maxSeq + 1}，收到 ${event.seq}）`, "EVENT_SEQ_GAP", { expected: maxSeq + 1, seq: event.seq });
    }
    if (kind === "duplicate") {
      const existing = bySeq.get(event.seq);
      if (!existing || !isAction(existing.action) || !actionsEqual(existing.action, event.action)) {
        throw new HttpError(409, `事件 ${event.seq} 已存在且內容不同`, "EVENT_SEQ_MISMATCH", { seq: event.seq });
      }
      continue;
    }
    accepted.push({ seq: event.seq, action: event.action });
    maxSeq = event.seq;
  }

  const toCreate: Prisma.MatchEventCreateManyInput[] = [];
  if (accepted.length > 0) {
    if (!isPlayerCount(match.playerCount)) {
      throw new HttpError(400, "對局人數無效", "INVALID_PLAYER_COUNT");
    }
    if (match.difficulty !== "balanced" && match.difficulty !== "aggressive") {
      throw new HttpError(400, "對局難度無效", "INVALID_DIFFICULTY");
    }
    const existingActions = stored.map((event) => {
      if (!isAction(event.action)) {
        throw new HttpError(409, `事件 ${event.seq} 無法重放`, "EVENT_REPLAY_FAILED", { seq: event.seq });
      }
      return event.action;
    });
    const replayed = replayStoredActions({
      matchId: match.id,
      playerCount: match.playerCount,
      difficulty: match.difficulty,
      seed: match.seed,
      humanName: match.humanName,
      actions: existingActions,
      seatNames: replaySeatNames(match),
    });
    if (!replayed.ok) {
      throw new HttpError(409, replayed.message, "MATCH_REPLAY_FAILED");
    }
    let state = replayed.state;
    for (const event of accepted) {
      const meta = describeActionContext(state);
      if (!meta) {
        throw new HttpError(400, `事件 ${event.seq} 無法對應行動者`, "EVENT_NO_ACTOR", { seq: event.seq });
      }
      try {
        state = applyAction(state, event.action);
      } catch (err) {
        const detail = applyFailureDetail(err);
        throw new HttpError(400, `事件 ${event.seq} 無法套用：${detail}`, "EVENT_APPLY_FAILED", {
          seq: event.seq,
          detail,
        });
      }
      const actor = match.participants.find((p) => p.seatIndex === meta.actorSeatIndex);
      toCreate.push({
        matchId: match.id,
        seq: event.seq,
        round: meta.round,
        phaseType: meta.phaseType,
        activeRole: meta.activeRole,
        actorSeatIndex: meta.actorSeatIndex,
        actorUserId: actor?.userId ?? null,
        action: event.action as Prisma.InputJsonValue,
      });
    }

    try {
      await prisma.matchEvent.createMany({ data: toCreate });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        throw new HttpError(409, "事件序號衝突，請重試", "EVENT_SEQ_CONFLICT");
      }
      throw err;
    }
    replayCache.write(match.id, maxSeq, state);
  }

  res.json({ appended: toCreate.length, eventCount: maxSeq });
});

matchesRouter.post("/:id/finish", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  const finished = await finishMatch(match.id);
  dropLiveMatch(match.id);
  const updated = await loadOwnedMatch(match.id, identity);
  res.json({
    ...matchSummary(updated),
    scores: finished.scores,
    endReason: finished.endReason,
  });
});

matchesRouter.post("/:id/abandon", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  if (match.status === "finished") {
    throw new HttpError(409, "對局已結束", "MATCH_ALREADY_ENDED");
  }
  if (match.status === "playing") {
    await withMatchLock(match.id, async () => {
      await prisma.match.update({
        where: { id: match.id },
        data: { status: "abandoned", endedAt: new Date(), verified: false },
      });
      dropLiveMatch(match.id);
    });
    broadcastMatchAbandoned(match.id);
  }
  replayCache.drop(match.id);
  const updated = await loadOwnedMatch(match.id, identity);
  res.json(matchSummary(updated));
});

matchesRouter.post("/:id/save-consent", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  const seat = match.participants.find(
    (p) =>
      p.isHuman &&
      ((identity.userId && p.userId === identity.userId) || (identity.guestId && p.guestId === identity.guestId)),
  );
  if (!seat) {
    throw new HttpError(403, "只有該局玩家才能同意存檔", "SAVE_CONSENT_FORBIDDEN");
  }

  await prisma.saveConsent.upsert({
    where: { matchId_seatIndex: { matchId: match.id, seatIndex: seat.seatIndex } },
    create: { matchId: match.id, seatIndex: seat.seatIndex, userId: seat.userId, guestId: seat.guestId },
    update: { userId: seat.userId, guestId: seat.guestId },
  });

  const humanSeats = match.participants.filter((p) => p.isHuman);
  const consents = await prisma.saveConsent.findMany({ where: { matchId: match.id } });
  const consentedSeats = new Set(consents.map((c) => c.seatIndex));
  const complete = humanSeats.every((p) => consentedSeats.has(p.seatIndex));

  if (complete && match.mode === "online") {
    if (!isPlayerCount(match.playerCount)) {
      throw new HttpError(400, "對局人數無效", "INVALID_PLAYER_COUNT");
    }
    if (match.difficulty !== "balanced" && match.difficulty !== "aggressive") {
      throw new HttpError(400, "對局難度無效", "INVALID_DIFFICULTY");
    }
    const events = await prisma.matchEvent.findMany({
      where: { matchId: match.id },
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
      matchId: match.id,
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
    const stateJson = replayed.state as unknown as Prisma.InputJsonValue;
    await prisma.matchSave.upsert({
      where: { matchId: match.id },
      create: {
        matchId: match.id,
        stateJson,
        schemaVersion: SAVE_SCHEMA_VERSION,
        savedByUserId: identity.userId ?? null,
        consentRequired: true,
      },
      update: {
        stateJson,
        schemaVersion: SAVE_SCHEMA_VERSION,
        savedByUserId: identity.userId ?? null,
        consentRequired: true,
      },
    });
  }

  res.json({
    matchId: match.id,
    seatIndex: seat.seatIndex,
    consented: humanSeats.filter((p) => consentedSeats.has(p.seatIndex)).length,
    required: humanSeats.length,
    complete,
  });
});

matchesRouter.put("/:id/save", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  assertPlaying(match.status);
  if (match.mode === "online") {
    throw new HttpError(403, "線上對局需全體玩家同意才能存檔", "SAVE_CONSENT_REQUIRED");
  }
  const body = z
    .object({
      state: z.unknown(),
      schemaVersion: z.string().default(SAVE_SCHEMA_VERSION),
    })
    .parse(req.body);
  if (!isSupportedSaveSchema(body.schemaVersion)) {
    throw new HttpError(400, "不支援的存檔版本", "SAVE_UNSUPPORTED_VERSION");
  }
  if (!body.state || typeof body.state !== "object") {
    throw new HttpError(400, "存檔狀態無效", "SAVE_INVALID_STATE");
  }

  const saved = await prisma.matchSave.upsert({
    where: { matchId: match.id },
    create: {
      matchId: match.id,
      stateJson: body.state as Prisma.InputJsonValue,
      schemaVersion: body.schemaVersion,
      savedByUserId: identity.userId ?? null,
      consentRequired: false,
    },
    update: {
      stateJson: body.state as Prisma.InputJsonValue,
      schemaVersion: body.schemaVersion,
      savedByUserId: identity.userId ?? null,
    },
  });

  res.json({
    matchId: saved.matchId,
    schemaVersion: saved.schemaVersion,
    savedAt: saved.savedAt,
    consentRequired: saved.consentRequired,
  });
});

matchesRouter.get("/:id/save", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  if (
    !canReadMatchSave({
      mode: match.mode,
      save: match.save,
      participants: match.participants,
      consents: match.saveConsents,
    })
  ) {
    throw new HttpError(403, "需全體玩家同意才能讀取存檔", "SAVE_CONSENT_REQUIRED");
  }
  if (!match.save) {
    throw new HttpError(404, "沒有存檔", "SAVE_NOT_FOUND");
  }
  if (!isSupportedSaveSchema(match.save.schemaVersion)) {
    throw new HttpError(409, "存檔版本過舊或未知，無法讀取", "SAVE_VERSION_STALE");
  }
  res.json({
    matchId: match.save.matchId,
    schemaVersion: match.save.schemaVersion,
    savedAt: match.save.savedAt,
    consentRequired: match.save.consentRequired,
    state: redactSavedStateForClient(match.mode, match.save.stateJson),
  });
});

export const meRouter = Router();

meRouter.get("/matches", async (req, res) => {
  const { userId } = requireUser(req);
  const matches = await prisma.match.findMany({
    where: { participants: { some: { userId } } },
    orderBy: { startedAt: "desc" },
    take: 30,
    include: { participants: { orderBy: { seatIndex: "asc" } }, save: true, _count: { select: { events: true } } },
  });
  res.json({ matches: matches.map(matchSummary) });
});

meRouter.get("/stats", async (req, res) => {
  const { userId } = requireUser(req);
  const stats = await prisma.userStats.findUnique({ where: { userId } });
  res.json({
    gamesPlayed: stats?.gamesPlayed ?? 0,
    gamesWon: stats?.gamesWon ?? 0,
    totalScore: stats?.totalScore ?? 0,
    bestScore: stats?.bestScore ?? 0,
    lastPlayedAt: stats?.lastPlayedAt ?? null,
  });
});

import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { requireIdentity, requireUser } from "../identity";
import { canAccessMatch } from "./access";
import { isAction, isSupportedSaveSchema, replayMatch, replayToState, SAVE_SCHEMA_VERSION } from "./replay";
import { classifySeq } from "./seq";

const AI_NAMES = ["伊莎貝拉", "迭戈", "卡塔莉娜", "羅倫佐"];

const nicknameSchema = z.string().trim().min(1).max(24);
const playerCountSchema = z.union([z.literal(3), z.literal(4), z.literal(5)]);
const difficultySchema = z.enum(["balanced", "aggressive"]);

const eventSchema = z.object({
  seq: z.number().int().positive(),
  round: z.number().int().positive(),
  phaseType: z.string().optional(),
  activeRole: z.string().nullable().optional(),
  actorSeatIndex: z.number().int().min(0),
  actorUserId: z.string().optional(),
  action: z.unknown(),
});

function assertPlaying(status: string): void {
  if (status !== "playing") {
    throw new HttpError(409, "對局已結束，無法再寫入");
  }
}

function scoreFields(score: {
  vpChips: number;
  buildingVp: number;
  guildHall: number;
  residence: number;
  fortress: number;
  customsHouse: number;
  cityHall: number;
  total: number;
}) {
  return {
    vpChips: score.vpChips,
    buildingVp: score.buildingVp,
    guildHall: score.guildHall,
    residence: score.residence,
    fortress: score.fortress,
    customsHouse: score.customsHouse,
    cityHall: score.cityHall,
    total: score.total,
  };
}

function matchIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || !id) throw new HttpError(400, "缺少對局 id");
  return id;
}

async function loadOwnedMatch(matchId: string, identity: { userId?: string; guestId?: string }) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: { orderBy: { seatIndex: "asc" } }, save: true, _count: { select: { events: true } } },
  });
  if (!match) throw new HttpError(404, "找不到對局");
  if (!canAccessMatch(match, identity)) throw new HttpError(403, "無權存取此對局");
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
  }>;
  save: { matchId: string } | null;
  _count: { events: number };
}) {
  return {
    id: match.id,
    mode: match.mode,
    playerCount: match.playerCount,
    difficulty: match.difficulty,
    seed: match.seed,
    humanName: match.humanName,
    endReason: match.endReason,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    status: match.status,
    verified: match.verified,
    eventCount: match._count.events,
    hasSave: Boolean(match.save),
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
      nickname: isHuman ? body.nickname : `AI ${AI_NAMES[i - 1]}`,
      userId: isHuman ? identity.userId ?? null : null,
      guestId: isHuman ? identity.guestId ?? null : null,
      isHuman,
      isAi: !isHuman,
    });
  }

  if (participants[0] && !participants[0].userId && !participants[0].guestId) {
    throw new HttpError(401, "需要登入或訪客工作階段");
  }

  const match = await prisma.match.create({
    data: {
      mode: "solo",
      playerCount: body.playerCount,
      difficulty: body.difficulty,
      seed,
      humanName: body.nickname,
      participants: { create: participants },
    },
    include: { participants: { orderBy: { seatIndex: "asc" } }, save: true, _count: { select: { events: true } } },
  });

  res.status(201).json(matchSummary(match));
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
    throw new HttpError(404, "無法找到該局遊戲");
  }
  if (match.playerCount !== 3 && match.playerCount !== 4 && match.playerCount !== 5) {
    throw new HttpError(404, "無法找到該局遊戲");
  }
  if (match.difficulty !== "balanced" && match.difficulty !== "aggressive") {
    throw new HttpError(404, "無法找到該局遊戲");
  }

  const events = await prisma.matchEvent.findMany({
    where: { matchId: match.id },
    orderBy: { seq: "asc" },
  });
  if (events.length !== match._count.events) {
    throw new HttpError(404, "無法找到該局遊戲");
  }
  const actions = events.map((event, index) => {
    if (event.seq !== index + 1) {
      throw new HttpError(404, "無法找到該局遊戲");
    }
    if (!isAction(event.action)) {
      throw new HttpError(404, "無法找到該局遊戲");
    }
    return event.action;
  });

  const replayed = replayToState({
    playerCount: match.playerCount,
    difficulty: match.difficulty,
    seed: match.seed,
    humanName: match.humanName,
    actions,
  });
  if (!replayed.ok) {
    throw new HttpError(404, "無法找到該局遊戲");
  }

  res.json({ ...matchSummary(match), state: replayed.state });
});

matchesRouter.post("/:id/events", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  assertPlaying(match.status);

  const body = z.object({ events: z.array(eventSchema).min(1).max(200) }).parse(req.body);
  const incoming = [...body.events].sort((a, b) => a.seq - b.seq);
  let maxSeq = match._count.events;
  const toCreate: Prisma.MatchEventCreateManyInput[] = [];

  for (const event of incoming) {
    if (!isAction(event.action)) {
      throw new HttpError(400, `事件 ${event.seq} 的 action 無效`);
    }
    const kind = classifySeq(event.seq, maxSeq);
    if (kind === "gap") {
      throw new HttpError(409, `事件序號不連續（期望 ${maxSeq + 1}，收到 ${event.seq}）`);
    }
    if (kind === "duplicate") {
      const existing = await prisma.matchEvent.findUnique({
        where: { matchId_seq: { matchId: match.id, seq: event.seq } },
      });
      if (existing && JSON.stringify(existing.action) !== JSON.stringify(event.action)) {
        throw new HttpError(409, `事件 ${event.seq} 已存在且內容不同`);
      }
      continue;
    }
    toCreate.push({
      matchId: match.id,
      seq: event.seq,
      round: event.round,
      phaseType: event.phaseType ?? null,
      activeRole: event.activeRole ?? null,
      actorSeatIndex: event.actorSeatIndex,
      actorUserId: event.actorUserId ?? identity.userId ?? null,
      action: event.action as Prisma.InputJsonValue,
    });
    maxSeq = event.seq;
  }

  if (toCreate.length > 0) {
    await prisma.matchEvent.createMany({ data: toCreate });
  }

  res.json({ appended: toCreate.length, eventCount: maxSeq });
});

matchesRouter.post("/:id/finish", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);

  if (match.status === "abandoned") {
    throw new HttpError(409, "對局已放棄，無法計分");
  }

  if (match.status === "finished" && match.verified) {
    res.json({
      ...matchSummary(match),
      scores: match.participants
        .filter((p) => p.total !== null)
        .map((p) => ({
          playerId: `p${p.seatIndex}`,
          name: p.nickname,
          ...scoreFields({
            vpChips: p.vpChips ?? 0,
            buildingVp: p.buildingVp ?? 0,
            guildHall: p.guildHall ?? 0,
            residence: p.residence ?? 0,
            fortress: p.fortress ?? 0,
            customsHouse: p.customsHouse ?? 0,
            cityHall: p.cityHall ?? 0,
            total: p.total ?? 0,
          }),
        })),
    });
    return;
  }

  const events = await prisma.matchEvent.findMany({
    where: { matchId: match.id },
    orderBy: { seq: "asc" },
  });
  if (events.length !== match._count.events) {
    throw new HttpError(409, "事件序號不完整");
  }
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.seq !== i + 1) {
      throw new HttpError(409, "事件序號不完整");
    }
  }

  const actions = events.map((event) => {
    if (!isAction(event.action)) {
      throw new HttpError(400, `事件 ${event.seq} 無法重放`);
    }
    return event.action;
  });

  if (match.playerCount !== 3 && match.playerCount !== 4 && match.playerCount !== 5) {
    throw new HttpError(400, "對局人數無效");
  }
  if (match.difficulty !== "balanced" && match.difficulty !== "aggressive") {
    throw new HttpError(400, "對局難度無效");
  }

  const replayed = replayMatch({
    playerCount: match.playerCount,
    difficulty: match.difficulty,
    seed: match.seed,
    humanName: match.humanName,
    actions,
  });
  if (!replayed.ok) {
    throw new HttpError(400, replayed.message);
  }

  const now = new Date();
  const human = replayed.scores.find((s) => s.playerId === "p0");
  const winner = replayed.scores[0];
  const humanWon = Boolean(human && winner && human.playerId === winner.playerId);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.match.updateMany({
      where: { id: match.id, status: "playing" },
      data: {
        status: "finished",
        verified: true,
        endedAt: now,
        endReason: replayed.state.endReason,
      },
    });
    if (claimed.count === 0) {
      return;
    }

    for (const participant of match.participants) {
      const score = replayed.scores.find((s) => s.playerId === `p${participant.seatIndex}`);
      if (!score) continue;
      await tx.matchParticipant.update({
        where: { id: participant.id },
        data: scoreFields(score),
      });
    }

    const userId = match.participants.find((p) => p.isHuman)?.userId;
    if (userId && human) {
      const existing = await tx.userStats.findUnique({ where: { userId } });
      await tx.userStats.upsert({
        where: { userId },
        create: {
          userId,
          gamesPlayed: 1,
          gamesWon: humanWon ? 1 : 0,
          totalScore: human.total,
          bestScore: human.total,
          lastPlayedAt: now,
        },
        update: {
          gamesPlayed: { increment: 1 },
          gamesWon: { increment: humanWon ? 1 : 0 },
          totalScore: { increment: human.total },
          bestScore: Math.max(existing?.bestScore ?? 0, human.total),
          lastPlayedAt: now,
        },
      });
    }
  });

  const updated = await loadOwnedMatch(match.id, identity);
  res.json({
    ...matchSummary(updated),
    scores: replayed.scores,
    endReason: replayed.state.endReason,
  });
});

matchesRouter.post("/:id/abandon", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  if (match.status === "finished") {
    throw new HttpError(409, "對局已結束");
  }
  if (match.status === "playing") {
    await prisma.match.update({
      where: { id: match.id },
      data: { status: "abandoned", endedAt: new Date(), verified: false },
    });
  }
  const updated = await loadOwnedMatch(match.id, identity);
  res.json(matchSummary(updated));
});

matchesRouter.put("/:id/save", async (req, res) => {
  const identity = requireIdentity(req);
  const match = await loadOwnedMatch(matchIdParam(req), identity);
  assertPlaying(match.status);
  const body = z
    .object({
      state: z.unknown(),
      schemaVersion: z.string().default(SAVE_SCHEMA_VERSION),
    })
    .parse(req.body);
  if (!isSupportedSaveSchema(body.schemaVersion)) {
    throw new HttpError(400, "不支援的存檔版本");
  }
  if (!body.state || typeof body.state !== "object") {
    throw new HttpError(400, "存檔狀態無效");
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
  if (!match.save) {
    throw new HttpError(404, "沒有存檔");
  }
  if (!isSupportedSaveSchema(match.save.schemaVersion)) {
    throw new HttpError(409, "存檔版本過舊或未知，無法讀取");
  }
  res.json({
    matchId: match.save.matchId,
    schemaVersion: match.save.schemaVersion,
    savedAt: match.save.savedAt,
    consentRequired: match.save.consentRequired,
    state: match.save.stateJson,
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

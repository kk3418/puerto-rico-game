import type { Prisma, PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { createInitialState, type GameState, type PlayerCount } from "../../../src/engine";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { requireIdentity, type SessionIdentity } from "../identity";
import { nicknameSchema } from "../validation";

type Db = PrismaClient | Prisma.TransactionClient;

const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 6;
const ONLINE_ACTIVE_STATUSES = ["lobby", "playing"];

const createBodySchema = z.object({
  nickname: nicknameSchema,
  playerCount: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
});

const joinBodySchema = z
  .object({
    nickname: nicknameSchema,
    joinCode: z.string().trim().min(1).optional(),
    roomId: z.string().trim().min(1).optional(),
  })
  .refine((body) => Boolean(body.joinCode ?? body.roomId), { message: "缺少加入碼或房間 id" });

type RoomParticipant = {
  seatIndex: number;
  nickname: string;
  userId: string | null;
  guestId: string | null;
};

type RoomMatch = {
  id: string;
  joinCode: string | null;
  playerCount: number;
  status: string;
  hostSeatIndex: number;
  startedAt: Date;
  participants: RoomParticipant[];
};

function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET.charAt(randomInt(JOIN_CODE_ALPHABET.length));
  }
  return code;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === "P2002");
}

function roomIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || !id) throw new HttpError(400, "缺少房間 id", "MISSING_ROOM_ID");
  return id;
}

function holdsSeat(participant: { userId: string | null; guestId: string | null }, identity: SessionIdentity): boolean {
  return Boolean(
    (identity.userId && participant.userId === identity.userId) ||
      (identity.guestId && participant.guestId === identity.guestId),
  );
}

async function assertNoActiveOnlineMatch(identity: SessionIdentity, db: Db = prisma): Promise<void> {
  const existing = await db.matchParticipant.findFirst({
    where: {
      OR: [
        ...(identity.userId ? [{ userId: identity.userId }] : []),
        ...(identity.guestId ? [{ guestId: identity.guestId }] : []),
      ],
      match: { mode: "online", status: { in: ONLINE_ACTIVE_STATUSES } },
    },
  });
  if (existing) {
    throw new HttpError(409, "已有進行中的線上對局", "ROOM_ALREADY_IN_MATCH");
  }
}

function roomSummary(match: RoomMatch) {
  const seats = [...match.participants].sort((a, b) => a.seatIndex - b.seatIndex);
  const host = seats.find((p) => p.seatIndex === match.hostSeatIndex);
  return {
    id: match.id,
    joinCode: match.joinCode,
    playerCount: match.playerCount,
    status: match.status,
    hostSeatIndex: match.hostSeatIndex,
    hostNickname: host?.nickname ?? null,
    seatsTaken: seats.length,
    startedAt: match.startedAt,
    seats: seats.map((p) => ({
      seatIndex: p.seatIndex,
      nickname: p.nickname,
      userId: p.userId,
      guestId: p.guestId,
    })),
  };
}

function roomListItem(match: RoomMatch) {
  const host = match.participants.find((p) => p.seatIndex === match.hostSeatIndex);
  return {
    id: match.id,
    joinCode: match.joinCode,
    playerCount: match.playerCount,
    hostNickname: host?.nickname ?? null,
    seatsTaken: match.participants.length,
    startedAt: match.startedAt,
  };
}

async function loadOnlineRoom(id: string, db: Db = prisma) {
  const match = await db.match.findUnique({
    where: { id },
    include: { participants: { orderBy: { seatIndex: "asc" } } },
  });
  if (!match || match.mode !== "online") {
    throw new HttpError(404, "找不到房間", "ROOM_NOT_FOUND");
  }
  return match;
}

export const roomsRouter = Router();

roomsRouter.post("/", async (req, res) => {
  const identity = requireIdentity(req);
  const body = createBodySchema.parse(req.body);
  if (identity.guestId) {
    req.session.guestNickname = body.nickname;
  }
  await assertNoActiveOnlineMatch(identity);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const match = await prisma.match.create({
        data: {
          mode: "online",
          status: "lobby",
          playerCount: body.playerCount,
          difficulty: "balanced",
          seed: randomInt(0x7fffffff),
          humanName: body.nickname,
          joinCode: generateJoinCode(),
          hostSeatIndex: 0,
          participants: {
            create: [
              {
                seatIndex: 0,
                nickname: body.nickname,
                userId: identity.userId ?? null,
                guestId: identity.guestId ?? null,
                isHuman: true,
                isAi: false,
              },
            ],
          },
        },
        include: { participants: { orderBy: { seatIndex: "asc" } } },
      });
      res.status(201).json(roomSummary(match));
      return;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new HttpError(500, "無法產生加入碼", "ROOM_CODE_FAILED");
});

roomsRouter.get("/", async (req, res) => {
  requireIdentity(req);
  const matches = await prisma.match.findMany({
    where: { mode: "online", status: "lobby" },
    orderBy: { startedAt: "asc" },
    take: 50,
    include: { participants: { orderBy: { seatIndex: "asc" } } },
  });
  res.json({ rooms: matches.map(roomListItem) });
});

roomsRouter.post("/join", async (req, res) => {
  const identity = requireIdentity(req);
  const body = joinBodySchema.parse(req.body);
  if (identity.guestId) {
    req.session.guestNickname = body.nickname;
  }
  const joinCode = body.joinCode?.toUpperCase();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const joined = await prisma.$transaction(async (tx) => {
        const match = await tx.match.findFirst({
          where: joinCode ? { joinCode, mode: "online" } : { id: body.roomId!, mode: "online" },
          include: { participants: { orderBy: { seatIndex: "asc" } } },
        });
        if (!match) throw new HttpError(404, "找不到房間", "ROOM_NOT_FOUND");
        if (match.status !== "lobby") {
          throw new HttpError(409, "房間已開局或已關閉", "ROOM_NOT_LOBBY");
        }
        if (match.participants.some((p) => holdsSeat(p, identity))) {
          throw new HttpError(409, "你已在這個房間", "ROOM_ALREADY_IN_MATCH");
        }
        await assertNoActiveOnlineMatch(identity, tx);

        let seatIndex = -1;
        for (let i = 0; i < match.playerCount; i++) {
          if (!match.participants.some((p) => p.seatIndex === i)) {
            seatIndex = i;
            break;
          }
        }
        if (seatIndex === -1) throw new HttpError(409, "房間已滿", "ROOM_FULL");

        const created = await tx.matchParticipant.create({
          data: {
            matchId: match.id,
            seatIndex,
            nickname: body.nickname,
            userId: identity.userId ?? null,
            guestId: identity.guestId ?? null,
            isHuman: true,
            isAi: false,
          },
        });
        const participants = [...match.participants, created].sort((a, b) => a.seatIndex - b.seatIndex);

        let status = match.status;
        let state: GameState | null = null;
        if (participants.length === match.playerCount) {
          state = createInitialState({
            playerCount: match.playerCount as PlayerCount,
            difficulty: "balanced",
            seed: match.seed,
            humanName: match.humanName,
            seatNames: participants.map((p) => p.nickname),
          });
          await tx.match.update({ where: { id: match.id }, data: { status: "playing" } });
          status = "playing";
        }
        return { match, participants, status, state };
      });

      const room = roomSummary({ ...joined.match, status: joined.status, participants: joined.participants });
      res.json(joined.state ? { ...room, state: joined.state } : room);
      return;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw new HttpError(409, "加入房間時發生衝突，請重試", "ROOM_JOIN_CONFLICT");
});

roomsRouter.post("/:id/leave", async (req, res) => {
  const identity = requireIdentity(req);
  const id = roomIdParam(req);
  const room = await prisma.$transaction(async (tx) => {
    const match = await loadOnlineRoom(id, tx);
    if (match.status !== "lobby") {
      throw new HttpError(409, "對局已開始，無法離開房間", "ROOM_NOT_LOBBY");
    }
    const seat = match.participants.find((p) => holdsSeat(p, identity));
    if (!seat) throw new HttpError(409, "你不在這個房間", "ROOM_NOT_JOINED");

    const remaining = match.participants.filter((p) => p.id !== seat.id);
    if (remaining.length === 0) {
      await tx.match.delete({ where: { id: match.id } });
      return null;
    }
    await tx.matchParticipant.delete({ where: { id: seat.id } });
    let hostSeatIndex = match.hostSeatIndex;
    if (hostSeatIndex === seat.seatIndex) {
      hostSeatIndex = remaining[0]!.seatIndex;
      await tx.match.update({ where: { id: match.id }, data: { hostSeatIndex } });
    }
    return roomSummary({ ...match, hostSeatIndex, participants: remaining });
  });
  res.json({ room });
});

roomsRouter.post("/:id/cancel", async (req, res) => {
  const identity = requireIdentity(req);
  const id = roomIdParam(req);
  await prisma.$transaction(async (tx) => {
    const match = await loadOnlineRoom(id, tx);
    if (match.status !== "lobby") {
      throw new HttpError(409, "對局已開始，無法取消房間", "ROOM_NOT_LOBBY");
    }
    const host = match.participants.find((p) => p.seatIndex === match.hostSeatIndex);
    if (!host || !holdsSeat(host, identity)) {
      throw new HttpError(403, "只有房主可以取消房間", "ROOM_NOT_HOST");
    }
    await tx.match.delete({ where: { id: match.id } });
  });
  res.json({ room: null });
});

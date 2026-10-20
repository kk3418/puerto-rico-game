import type { Prisma, PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { requireIdentity, type SessionIdentity } from "../identity";
import { nicknameSchema } from "../validation";
import { heartbeatLobby, holdsSeat, lockMatchRow, removeLobbySeats, seatIsStale } from "./presence";

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

const heartbeatBodySchema = z.object({
  ready: z.boolean().optional(),
});

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
                lobbySeenAt: new Date(),
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
  const now = Date.now();
  const rooms = [];
  for (const match of matches) {
    const fresh = match.participants.filter((p) => !seatIsStale(p.lobbySeenAt, now));
    if (fresh.length === 0 || fresh.length >= match.playerCount) continue;
    rooms.push(roomListItem({ ...match, participants: fresh }));
  }
  res.json({ rooms });
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
        const located = await tx.match.findFirst({
          where: joinCode ? { joinCode, mode: "online" } : { id: body.roomId!, mode: "online" },
          select: { id: true },
        });
        if (!located) throw new HttpError(404, "找不到房間", "ROOM_NOT_FOUND");
        await lockMatchRow(located.id, tx);
        const match = await tx.match.findFirst({
          where: { id: located.id, mode: "online" },
          include: { participants: { orderBy: { seatIndex: "asc" } } },
        });
        if (!match) throw new HttpError(404, "找不到房間", "ROOM_NOT_FOUND");

        const now = Date.now();
        const stale = match.participants.filter((p) => seatIsStale(p.lobbySeenAt, now));
        let hostSeatIndex = match.hostSeatIndex;
        let participants = match.participants;
        if (stale.length > 0 && stale.length === match.participants.length) {
          await tx.matchParticipant.deleteMany({ where: { matchId: match.id } });
          hostSeatIndex = 0;
          await tx.match.update({ where: { id: match.id }, data: { hostSeatIndex } });
          participants = [];
        } else if (stale.length > 0) {
          const removed = await removeLobbySeats(
            match,
            stale.map((p) => p.id),
            tx,
          );
          if (removed.deleted) throw new HttpError(404, "找不到房間", "ROOM_NOT_FOUND");
          hostSeatIndex = removed.hostSeatIndex;
          participants = removed.participants;
        }

        if (match.status !== "lobby") {
          throw new HttpError(409, "房間已開局或已關閉", "ROOM_NOT_LOBBY");
        }
        if (participants.some((p) => holdsSeat(p, identity))) {
          throw new HttpError(409, "你已在這個房間", "ROOM_ALREADY_IN_MATCH");
        }
        await assertNoActiveOnlineMatch(identity, tx);

        let seatIndex = -1;
        for (let i = 0; i < match.playerCount; i++) {
          if (!participants.some((p) => p.seatIndex === i)) {
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
            lobbySeenAt: new Date(),
          },
        });
        const seated = [...participants, created].sort((a, b) => a.seatIndex - b.seatIndex);
        return { match: { ...match, hostSeatIndex }, participants: seated };
      });

      res.json(roomSummary({ ...joined.match, participants: joined.participants }));
      return;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw new HttpError(409, "加入房間時發生衝突，請重試", "ROOM_JOIN_CONFLICT");
});

roomsRouter.post("/:id/heartbeat", async (req, res) => {
  const identity = requireIdentity(req);
  const id = roomIdParam(req);
  const body = heartbeatBodySchema.parse(req.body ?? {});
  const result = await heartbeatLobby(id, identity, body.ready === true);
  if (result.status === "missing") throw new HttpError(404, "找不到房間", "ROOM_NOT_FOUND");
  if (result.status === "forbidden") throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
  res.json(roomSummary(result.match));
});

roomsRouter.post("/:id/leave", async (req, res) => {
  const identity = requireIdentity(req);
  const id = roomIdParam(req);
  const room = await prisma.$transaction(async (tx) => {
    await lockMatchRow(id, tx);
    const match = await loadOnlineRoom(id, tx);
    if (match.status !== "lobby") {
      throw new HttpError(409, "對局已開始，無法離開房間", "ROOM_NOT_LOBBY");
    }
    const seat = match.participants.find((p) => holdsSeat(p, identity));
    if (!seat) throw new HttpError(409, "你不在這個房間", "ROOM_NOT_JOINED");

    const removed = await removeLobbySeats(match, [seat.id], tx);
    if (removed.deleted) return null;
    return roomSummary({ ...match, hostSeatIndex: removed.hostSeatIndex, participants: removed.participants });
  });
  res.json({ room });
});

roomsRouter.post("/:id/cancel", async (req, res) => {
  const identity = requireIdentity(req);
  const id = roomIdParam(req);
  await prisma.$transaction(async (tx) => {
    await lockMatchRow(id, tx);
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

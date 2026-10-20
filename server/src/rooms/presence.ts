import type { Match, MatchParticipant, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import type { SessionIdentity } from "../identity";

type Db = PrismaClient | Prisma.TransactionClient;

type SeatedMatch = Match & { participants: MatchParticipant[] };

/**
 * Lobby heartbeats every 2s. Hidden tabs are often throttled to about once a minute,
 * so a seat stays until it has been quiet for longer than that gap.
 * A server stall that quiets every seat is treated separately in `heartbeatLobby`.
 */
export const LOBBY_STALE_MS = 90_000;

/** A full room starts only when every seat has acknowledged within this window. */
export const LOBBY_READY_FRESH_MS = 15_000;

export function holdsSeat(
  participant: { userId: string | null; guestId: string | null },
  identity: SessionIdentity,
): boolean {
  return Boolean(
    (identity.userId && participant.userId === identity.userId) ||
      (identity.guestId && participant.guestId === identity.guestId),
  );
}

export function seatIsStale(seenAt: Date | null | undefined, now = Date.now()): boolean {
  if (seenAt == null) return false;
  return seenAt.getTime() < now - LOBBY_STALE_MS;
}

function readyIsFresh(readyAt: Date | null | undefined, now: number): boolean {
  return readyAt != null && readyAt.getTime() >= now - LOBBY_READY_FRESH_MS;
}

export async function lockMatchRow(matchId: string, db: Db): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
}

/** Drop the given seats, clear ready, and hand the host role to the lowest seat that remains. */
export async function removeLobbySeats<T extends { id: string; seatIndex: number }>(
  match: { id: string; hostSeatIndex: number; participants: T[] },
  removeIds: readonly string[],
  db: Db,
): Promise<{ deleted: true } | { deleted: false; hostSeatIndex: number; participants: T[] }> {
  const remove = new Set(removeIds);
  const remaining = match.participants.filter((p) => !remove.has(p.id));
  if (remaining.length === 0) {
    await db.match.delete({ where: { id: match.id } });
    return { deleted: true };
  }
  await db.matchParticipant.deleteMany({ where: { id: { in: [...remove] } } });
  await db.matchParticipant.updateMany({
    where: { matchId: match.id },
    data: { lobbyReadyAt: null },
  });
  let hostSeatIndex = match.hostSeatIndex;
  if (!remaining.some((p) => p.seatIndex === hostSeatIndex)) {
    hostSeatIndex = [...remaining].sort((a, b) => a.seatIndex - b.seatIndex)[0]!.seatIndex;
    await db.match.update({ where: { id: match.id }, data: { hostSeatIndex } });
  }
  const participants = remaining.map((p) => ({ ...p, lobbyReadyAt: null }));
  return { deleted: false, hostSeatIndex, participants };
}

export type HeartbeatResult =
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "ok"; match: SeatedMatch };

/**
 * Record presence for someone already seated. Does not lock or write when the caller has no seat.
 * When every seat is stale together, refresh them instead of deleting the room on the first request back.
 */
export async function heartbeatLobby(
  matchId: string,
  identity: SessionIdentity,
  ready: boolean,
): Promise<HeartbeatResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.match.findUnique({
      where: { id: matchId },
      include: { participants: { orderBy: { seatIndex: "asc" } } },
    });
    if (!existing || existing.mode !== "online") return { status: "missing" };
    if (!existing.participants.some((p) => holdsSeat(p, identity))) return { status: "forbidden" };
    if (existing.status !== "lobby") return { status: "ok", match: existing };

    await lockMatchRow(matchId, tx);
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: { participants: { orderBy: { seatIndex: "asc" } } },
    });
    if (!match || match.mode !== "online") return { status: "missing" };
    const seat = match.participants.find((p) => holdsSeat(p, identity));
    if (!seat) return { status: "forbidden" };
    if (match.status !== "lobby") return { status: "ok", match };

    const now = new Date();
    const nowMs = now.getTime();
    let participants = match.participants;
    let hostSeatIndex = match.hostSeatIndex;

    const allStale = participants.every((p) => seatIsStale(p.lobbySeenAt, nowMs));
    if (allStale) {
      await tx.matchParticipant.updateMany({
        where: { matchId: match.id },
        data: { lobbySeenAt: now },
      });
      participants = participants.map((p) => ({ ...p, lobbySeenAt: now }));
    } else {
      const staleIds = participants
        .filter((p) => p.id !== seat.id && seatIsStale(p.lobbySeenAt, nowMs))
        .map((p) => p.id);
      if (staleIds.length > 0) {
        const removed = await removeLobbySeats(match, staleIds, tx);
        if (removed.deleted) return { status: "missing" };
        participants = removed.participants;
        hostSeatIndex = removed.hostSeatIndex;
      }
    }

    const roomFull = participants.length === match.playerCount;
    const markReady = ready && roomFull;
    await tx.matchParticipant.update({
      where: { id: seat.id },
      data: {
        lobbySeenAt: now,
        ...(markReady ? { lobbyReadyAt: now } : {}),
      },
    });
    participants = participants.map((p) =>
      p.id === seat.id ? { ...p, lobbySeenAt: now, lobbyReadyAt: markReady ? now : p.lobbyReadyAt } : p,
    );

    let status = match.status;
    if (roomFull && participants.every((p) => readyIsFresh(p.lobbyReadyAt, nowMs))) {
      status = "playing";
      await tx.match.update({ where: { id: match.id }, data: { status } });
    }

    return { status: "ok", match: { ...match, status, hostSeatIndex, participants } };
  });
}

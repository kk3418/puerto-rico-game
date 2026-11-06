import { Prisma, type Match, type MatchParticipant, type PrismaClient } from "@prisma/client";
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

/**
 * After a page hides, its seat goes stale this much later instead of after the full timeout.
 * A reload, another tab, or a restored page heartbeats well within it.
 */
export const LOBBY_AWAY_GRACE_MS = 10_000;

export function holdsSeat(
  participant: { userId: string | null; guestId: string | null },
  identity: SessionIdentity,
): boolean {
  return Boolean(
    (identity.userId && participant.userId === identity.userId) ||
      (identity.guestId && participant.guestId === identity.guestId),
  );
}

/** `where` clauses for seats held by this identity, matching `holdsSeat`. */
export function seatsHeldBy(identity: SessionIdentity): Prisma.MatchParticipantWhereInput[] {
  return [
    ...(identity.userId ? [{ userId: identity.userId }] : []),
    ...(identity.guestId ? [{ guestId: identity.guestId }] : []),
  ];
}

export function seatIsStale(seenAt: Date | null | undefined, now = Date.now()): boolean {
  if (seenAt == null) return false;
  return seenAt.getTime() < now - LOBBY_STALE_MS;
}

/** Seats seen at or after this time are not stale. */
export function lobbyFreshSince(now = Date.now()): Date {
  return new Date(now - LOBBY_STALE_MS);
}

function readyIsFresh(readyAt: Date | null | undefined, now: number): boolean {
  return readyAt != null && readyAt.getTime() >= now - LOBBY_READY_FRESH_MS;
}

export async function lockMatchRow(matchId: string, db: Db): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
}

/** Lock several rooms in id order, so two transactions that need the same rooms cannot deadlock. */
async function lockMatchRows(matchIds: readonly string[], db: Db): Promise<void> {
  if (matchIds.length === 0) return;
  const ids = Prisma.join([...new Set(matchIds)]);
  await db.$queryRaw`SELECT "id" FROM "Match" WHERE "id" IN (${ids}) ORDER BY "id" FOR UPDATE`;
}

function loadSeatedMatch(matchId: string, db: Db): Promise<SeatedMatch | null> {
  return db.match.findUnique({
    where: { id: matchId },
    include: { participants: { orderBy: { seatIndex: "asc" } } },
  });
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

/**
 * Drop this identity's own stale lobby seats, so a seat lost on another device or with
 * cleared storage does not block creating or joining a room.
 *
 * When joining, pass the target room: it is locked in the same id-ordered statement, so two
 * joins that each hold a stale seat in the other's room cannot deadlock. Seats in the target
 * room are left to the join, which keeps a room whose seats have all gone stale.
 */
export async function releaseOwnStaleSeats(
  identity: SessionIdentity,
  db: Db,
  joiningId?: string,
): Promise<void> {
  const now = Date.now();
  const stale = await db.matchParticipant.findMany({
    where: {
      OR: seatsHeldBy(identity),
      lobbySeenAt: { lt: lobbyFreshSince(now) },
      match: { mode: "online", status: "lobby" },
      ...(joiningId ? { matchId: { not: joiningId } } : {}),
    },
    select: { matchId: true },
  });
  const roomIds = [...new Set(stale.map((seat) => seat.matchId))];
  await lockMatchRows(joiningId ? [joiningId, ...roomIds] : roomIds, db);
  if (roomIds.length === 0) return;

  const rooms = await db.match.findMany({
    where: { id: { in: roomIds }, mode: "online", status: "lobby" },
    include: { participants: true },
  });
  for (const room of rooms) {
    const mine = room.participants.filter((p) => holdsSeat(p, identity) && seatIsStale(p.lobbySeenAt, now));
    if (mine.length === 0) continue;
    await removeLobbySeats(
      room,
      mine.map((p) => p.id),
      db,
    );
  }
}

type OwnLobbySeat =
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "started"; match: SeatedMatch }
  | { status: "seated"; match: SeatedMatch; seat: MatchParticipant };

/**
 * Find the caller's seat before taking the lock, so a caller without one never locks or writes the room.
 * Only a room still in the lobby is locked.
 */
async function lockOwnLobbySeat(
  matchId: string,
  identity: SessionIdentity,
  tx: Prisma.TransactionClient,
): Promise<OwnLobbySeat> {
  const existing = await loadSeatedMatch(matchId, tx);
  if (!existing || existing.mode !== "online") return { status: "missing" };
  if (!existing.participants.some((p) => holdsSeat(p, identity))) return { status: "forbidden" };
  if (existing.status !== "lobby") return { status: "started", match: existing };

  await lockMatchRow(matchId, tx);
  const match = await loadSeatedMatch(matchId, tx);
  if (!match || match.mode !== "online") return { status: "missing" };
  const seat = match.participants.find((p) => holdsSeat(p, identity));
  if (!seat) return { status: "forbidden" };
  if (match.status !== "lobby") return { status: "started", match };
  return { status: "seated", match, seat };
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
    const own = await lockOwnLobbySeat(matchId, identity, tx);
    if (own.status === "missing" || own.status === "forbidden") return own;
    if (own.status === "started") return { status: "ok", match: own.match };
    const { match, seat } = own;

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

export type AwayResult = { status: "missing" } | { status: "forbidden" } | { status: "ok" };

/**
 * Called when the caller's lobby page is hidden. Their seat goes stale after `LOBBY_AWAY_GRACE_MS`
 * unless a heartbeat comes back first, and their ready is cleared so the room cannot start without them.
 * Never moves a seat's last-seen time forward, and does nothing once the match has started.
 */
export async function markLobbyAway(matchId: string, identity: SessionIdentity): Promise<AwayResult> {
  return prisma.$transaction(async (tx) => {
    const own = await lockOwnLobbySeat(matchId, identity, tx);
    if (own.status === "missing" || own.status === "forbidden") return own;
    if (own.status === "started") return { status: "ok" };

    const awayAt = new Date(Date.now() - LOBBY_STALE_MS + LOBBY_AWAY_GRACE_MS);
    const seenAt = own.seat.lobbySeenAt < awayAt ? own.seat.lobbySeenAt : awayAt;
    await tx.matchParticipant.update({
      where: { id: own.seat.id },
      data: { lobbySeenAt: seenAt, lobbyReadyAt: null },
    });
    return { status: "ok" };
  });
}

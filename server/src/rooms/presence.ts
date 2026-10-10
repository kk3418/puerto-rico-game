import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import type { SessionIdentity } from "../identity";

type Db = PrismaClient | Prisma.TransactionClient;

/** Lobby polls every 2s. A closed tab stops polling; this is the backup if pagehide never arrives. */
export const LOBBY_STALE_MS = 20_000;

function holdsSeat(
  participant: { userId: string | null; guestId: string | null },
  identity: SessionIdentity,
): boolean {
  return Boolean(
    (identity.userId && participant.userId === identity.userId) ||
      (identity.guestId && participant.guestId === identity.guestId),
  );
}

export async function touchLobbyPresence(matchId: string, identity: SessionIdentity, db: Db = prisma): Promise<void> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { participants: true },
  });
  if (!match || match.mode !== "online" || match.status !== "lobby") return;
  const seat = match.participants.find((p) => holdsSeat(p, identity));
  if (!seat) return;
  await db.matchParticipant.update({ where: { id: seat.id }, data: { lobbySeenAt: new Date() } });
}

export async function dropStaleLobbySeats(matchId: string, db: Db = prisma): Promise<{ removed: string[] }> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    include: { participants: true },
  });
  if (!match || match.mode !== "online" || match.status !== "lobby") return { removed: [] };
  const cutoff = Date.now() - LOBBY_STALE_MS;
  const seenAt = (at: Date | null | undefined) => at?.getTime() ?? Date.now();
  const stale = match.participants.filter((p) => seenAt(p.lobbySeenAt) < cutoff);
  if (stale.length === 0) return { removed: [] };
  const remaining = match.participants.filter((p) => seenAt(p.lobbySeenAt) >= cutoff);
  const removed = stale.map((p) => p.nickname);
  if (remaining.length === 0) {
    await db.match.delete({ where: { id: match.id } });
  } else {
    await db.matchParticipant.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } });
    if (!remaining.some((p) => p.seatIndex === match.hostSeatIndex)) {
      const hostSeatIndex = [...remaining].sort((a, b) => a.seatIndex - b.seatIndex)[0]!.seatIndex;
      await db.match.update({ where: { id: match.id }, data: { hostSeatIndex } });
    }
  }
  return { removed };
}

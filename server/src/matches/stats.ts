import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type StatsParticipant = {
  isHuman: boolean;
  userId: string | null;
  total: number | null;
};

export type FinishedMatchStatsRow = {
  endedAt: Date | null;
  participants: StatsParticipant[];
};

export type AggregatedUserStats = {
  gamesPlayed: number;
  gamesWon: number;
  totalScore: number;
  bestScore: number;
  lastPlayedAt: Date | null;
};

export function humanWonMatch(participants: StatsParticipant[], userId: string): boolean {
  const human = participants.find((p) => p.isHuman && p.userId === userId);
  if (human?.total == null) return false;
  const humanTotal = human.total;
  const others = participants.filter((p) => p !== human);
  return others.every((p) => (p.total ?? Number.NEGATIVE_INFINITY) < humanTotal);
}

export function aggregateUserStats(matches: FinishedMatchStatsRow[], userId: string): AggregatedUserStats {
  let gamesPlayed = 0;
  let gamesWon = 0;
  let totalScore = 0;
  let bestScore = 0;
  let lastPlayedAt: Date | null = null;

  for (const match of matches) {
    const human = match.participants.find((p) => p.isHuman && p.userId === userId);
    if (human?.total == null) continue;
    gamesPlayed += 1;
    totalScore += human.total;
    bestScore = Math.max(bestScore, human.total);
    if (humanWonMatch(match.participants, userId)) gamesWon += 1;
    if (match.endedAt && (!lastPlayedAt || match.endedAt > lastPlayedAt)) {
      lastPlayedAt = match.endedAt;
    }
  }

  return { gamesPlayed, gamesWon, totalScore, bestScore, lastPlayedAt };
}

export async function refreshUserStats(db: Db, userId: string): Promise<void> {
  const matches = await db.match.findMany({
    where: {
      status: "finished",
      verified: true,
      participants: { some: { userId, isHuman: true } },
    },
    include: { participants: true },
  });
  const stats = aggregateUserStats(matches, userId);
  await db.userStats.upsert({
    where: { userId },
    create: { userId, ...stats },
    update: stats,
  });
}

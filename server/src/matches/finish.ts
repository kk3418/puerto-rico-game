import type { ScoreBreakdown } from "../../../src/engine";
import { isPlayerCount } from "../../../src/engine";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { isAction, replayMatch, replaySeatNames } from "./replay";
import { replayCache } from "./replayCache";
import { refreshUserStats } from "./stats";

export type FinishResult = {
  scores: ScoreBreakdown[];
  endReason: string | null;
};

function scoreFields(score: {
  vpChips: number;
  buildingVp: number;
  guildHall: number;
  residence: number;
  fortress: number;
  customsHouse: number;
  cityHall: number;
  total: number;
  goodsAndGold: number;
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
    goodsAndGold: score.goodsAndGold,
  };
}

export async function finishMatch(matchId: string): Promise<FinishResult> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: { orderBy: { seatIndex: "asc" } }, _count: { select: { events: true } } },
  });
  if (!match) throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");

  if (match.status === "abandoned") {
    throw new HttpError(409, "對局已放棄，無法計分", "MATCH_ABANDONED");
  }

  if (match.status === "finished" && match.verified) {
    return {
      endReason: match.endReason,
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
            goodsAndGold: p.goodsAndGold ?? 0,
          }),
        })),
    };
  }

  const events = await prisma.matchEvent.findMany({
    where: { matchId: match.id },
    orderBy: { seq: "asc" },
  });
  if (events.length !== match._count.events) {
    throw new HttpError(409, "事件序號不完整", "EVENT_SEQ_INCOMPLETE");
  }
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.seq !== i + 1) {
      throw new HttpError(409, "事件序號不完整", "EVENT_SEQ_INCOMPLETE");
    }
  }

  const actions = events.map((event) => {
    if (!isAction(event.action)) {
      throw new HttpError(400, `事件 ${event.seq} 無法重放`, "EVENT_REPLAY_FAILED", { seq: event.seq });
    }
    return event.action;
  });

  if (!isPlayerCount(match.playerCount)) {
    throw new HttpError(400, "對局人數無效", "INVALID_PLAYER_COUNT");
  }
  if (match.difficulty !== "balanced" && match.difficulty !== "aggressive") {
    throw new HttpError(400, "對局難度無效", "INVALID_DIFFICULTY");
  }

  const replayed = replayMatch({
    matchId: match.id,
    playerCount: match.playerCount,
    difficulty: match.difficulty,
    seed: match.seed,
    humanName: match.humanName,
    actions,
    seatNames: replaySeatNames(match),
  });
  if (!replayed.ok) {
    throw new HttpError(400, replayed.message, "MATCH_REPLAY_FAILED");
  }

  const now = new Date();

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

    const userIds = [
      ...new Set(
        match.participants
          .filter((p) => p.isHuman && p.userId !== null)
          .map((p) => p.userId as string),
      ),
    ];
    for (const userId of userIds) {
      await refreshUserStats(tx, userId);
    }
  });

  replayCache.drop(match.id);

  return { scores: replayed.scores, endReason: replayed.state.endReason };
}

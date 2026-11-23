import type { Match, MatchParticipant, MatchVote, MatchVoteBallot } from "@prisma/client";
import { getActorIndex, getLegalActions, type GameState } from "../../../src/engine";
import { HeuristicAgent } from "../../../src/agents/heuristic";
import { prisma } from "../db";
import { HttpError } from "../errors";
import type { SessionIdentity } from "../identity";
import { finishMatch } from "../matches/finish";
import {
  broadcastMatchOver,
  broadcastMatchState,
  broadcastSeatReplaced,
  broadcastVote,
} from "./liveBroadcast";
import {
  applySeatActionLocked,
  dropLiveMatch,
  getLiveState,
  markLiveSeatAi,
  withMatchLock,
} from "./liveMatches";
import { redactStateForClient } from "./redact";
import type { VoteChoice, VoteResult, VoteStatus, VoteView } from "./types";

type MatchWithParticipants = Match & { participants: MatchParticipant[] };
type VoteWithBallots = MatchVote & { ballots: MatchVoteBallot[] };

type IdleTimer = {
  seatIndex: number;
  phaseType: string;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
};

type PausedIdle = {
  seatIndex: number;
  phaseType: string;
  remainingMs: number;
};

const idleTimers = new Map<string, IdleTimer>();
const pausedIdle = new Map<string, PausedIdle>();
const aiTimers = new Map<string, ReturnType<typeof setTimeout>>();
const voteTimers = new Map<string, ReturnType<typeof setTimeout>>();

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function idleTurnMs(): number {
  return envMs("ONLINE_IDLE_MS", 90_000);
}

export function voteDurationMs(): number {
  return envMs("ONLINE_VOTE_MS", 60_000);
}

export function aiTurnDelayMs(): number {
  return envMs("ONLINE_AI_DELAY_MS", 800);
}

function loadMatch(matchId: string): Promise<MatchWithParticipants | null> {
  return prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: { orderBy: { seatIndex: "asc" } } },
  });
}

function humanSeatIndexes(match: MatchWithParticipants): number[] {
  return match.participants.filter((participant) => participant.isHuman && !participant.isAi).map((p) => p.seatIndex);
}

function voteResult(vote: MatchVote): VoteResult | null {
  return vote.result === "passed" || vote.result === "failed" || vote.result === "abandoned" ? vote.result : null;
}

function toVoteView(vote: VoteWithBallots, match: MatchWithParticipants): VoteView {
  const eligibleSeats = humanSeatIndexes(match);
  const ballots = vote.ballots
    .filter((ballot) => eligibleSeats.includes(ballot.seatIndex))
    .map((ballot) => ({ seatIndex: ballot.seatIndex, choice: ballot.choice as VoteChoice }))
    .sort((a, b) => a.seatIndex - b.seatIndex);
  const result = voteResult(vote);
  const status: VoteStatus = vote.resolvedAt ? (result ?? "abandoned") : "open";
  return {
    id: vote.id,
    matchId: vote.matchId,
    status,
    initiatedBySeat: vote.initiatedBySeat,
    createdAt: vote.createdAt.toISOString(),
    deadlineAt: vote.deadlineAt.toISOString(),
    resolvedAt: vote.resolvedAt?.toISOString() ?? null,
    result,
    eligibleSeats,
    ballots,
    approve: ballots.filter((ballot) => ballot.choice === "approve").length,
    oppose: ballots.filter((ballot) => ballot.choice === "oppose").length,
  };
}

async function loadOpenVote(matchId: string): Promise<VoteWithBallots | null> {
  return prisma.matchVote.findFirst({
    where: { matchId, resolvedAt: null },
    include: { ballots: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOpenVoteView(matchId: string): Promise<VoteView | null> {
  const [vote, match] = await Promise.all([loadOpenVote(matchId), loadMatch(matchId)]);
  if (!vote || !match) return null;
  return toVoteView(vote, match);
}

export async function getLatestVoteView(matchId: string): Promise<VoteView | null> {
  const [vote, match] = await Promise.all([
    prisma.matchVote.findFirst({
      where: { matchId },
      include: { ballots: true },
      orderBy: { createdAt: "desc" },
    }),
    loadMatch(matchId),
  ]);
  if (!vote || !match) return null;
  return toVoteView(vote, match);
}

export async function broadcastCurrentState(matchId: string): Promise<void> {
  const match = await loadMatch(matchId);
  if (!match || match.mode !== "online" || match.status !== "playing") return;
  try {
    const [live, vote] = await Promise.all([getLiveState(matchId), getOpenVoteView(matchId)]);
    broadcastMatchState(matchId, {
      state: redactStateForClient(live.state),
      legalActions: getLegalActions(live.state),
      eventCount: live.eventCount,
      vote,
    });
  } catch (err) {
    console.error(`Could not broadcast match state for ${matchId}`, err);
  }
}

export async function startEndVote(matchId: string, identity: SessionIdentity): Promise<VoteView> {
  if (!identity.userId) {
    throw new HttpError(401, "請先登入", "LOGIN_REQUIRED");
  }
  return withMatchLock(matchId, async () => {
    const match = await loadMatch(matchId);
    if (!match || match.mode !== "online") {
      throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");
    }
    if (match.status !== "playing") {
      throw new HttpError(409, "對局已結束，無法發起投票", "MATCH_NOT_PLAYING");
    }
    const seat = match.participants.find((participant) => participant.userId === identity.userId);
    if (!seat || !seat.isHuman || seat.isAi) {
      throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
    }
    const open = await loadOpenVote(matchId);
    if (open) {
      throw new HttpError(409, "已有進行中的投票", "VOTE_IN_PROGRESS");
    }
    const lastFailed = await prisma.matchVote.findFirst({
      where: { matchId, result: "failed", resolvedAtEventCount: { not: null } },
      orderBy: { resolvedAt: "desc" },
      select: { id: true, resolvedAtEventCount: true },
    });
    if (lastFailed?.resolvedAtEventCount != null) {
      const eventCount = await prisma.matchEvent.count({ where: { matchId } });
      if (eventCount <= lastFailed.resolvedAtEventCount) {
        throw new HttpError(409, "請先完成至少一次遊戲行動，才能再發起結束投票", "VOTE_REQUIRES_ACTION", {
          voteId: lastFailed.id,
        });
      }
    }
    if (humanSeatIndexes(match).length < 2) {
      await abandonMatchLocked(matchId);
      throw new HttpError(409, "對局已無足夠玩家", "MATCH_ABANDONED");
    }

    const vote = await prisma.matchVote.create({
      data: {
        matchId,
        initiatedBySeat: seat.seatIndex,
        deadlineAt: new Date(Date.now() + voteDurationMs()),
        ballots: {
          create: {
            seatIndex: seat.seatIndex,
            choice: "approve",
          },
        },
      },
      include: { ballots: true },
    });
    pauseIdleTimer(matchId);
    clearAiTimer(matchId);
    scheduleVoteExpiry(matchId, vote.id, vote.deadlineAt);
    const view = toVoteView(vote, match);
    broadcastVote(matchId, view);
    return view;
  });
}

export async function castEndVote(
  matchId: string,
  identity: SessionIdentity,
  choice: VoteChoice,
): Promise<VoteView> {
  if (!identity.userId) {
    throw new HttpError(401, "請先登入", "LOGIN_REQUIRED");
  }
  const view = await withMatchLock(matchId, async () => {
    const match = await loadMatch(matchId);
    if (!match || match.mode !== "online") {
      throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");
    }
    if (match.status !== "playing") {
      throw new HttpError(409, "對局已結束，無法投票", "MATCH_NOT_PLAYING");
    }
    const seat = match.participants.find((participant) => participant.userId === identity.userId);
    if (!seat || !seat.isHuman || seat.isAi) {
      throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
    }
    const vote = await loadOpenVote(matchId);
    if (!vote) {
      throw new HttpError(409, "目前沒有進行中的投票", "VOTE_NOT_OPEN");
    }
    if (vote.deadlineAt.getTime() <= Date.now()) {
      await resolveVoteLocked(matchId, vote, match);
      throw new HttpError(409, "投票已結束", "VOTE_NOT_OPEN");
    }

    await prisma.matchVoteBallot.upsert({
      where: { voteId_seatIndex: { voteId: vote.id, seatIndex: seat.seatIndex } },
      create: { voteId: vote.id, seatIndex: seat.seatIndex, choice },
      update: { choice },
    });
    const updated = await prisma.matchVote.findUnique({
      where: { id: vote.id },
      include: { ballots: true },
    });
    if (!updated) {
      throw new HttpError(409, "投票已結束", "VOTE_NOT_OPEN");
    }
    const next = toVoteView(updated, match);
    broadcastVote(matchId, next);

    const eligible = humanSeatIndexes(match);
    const voted = new Set(
      updated.ballots.filter((ballot) => eligible.includes(ballot.seatIndex)).map((ballot) => ballot.seatIndex),
    );
    if (eligible.length > 0 && eligible.every((seatIndex) => voted.has(seatIndex))) {
      const resolved = await resolveVoteLocked(matchId, updated, match);
      return resolved ?? next;
    }
    return next;
  });
  await ensureRuntime(matchId);
  return view;
}

async function resolveVoteLocked(
  matchId: string,
  voteInput: VoteWithBallots,
  matchInput?: MatchWithParticipants,
): Promise<VoteView | null> {
  const vote = await prisma.matchVote.findUnique({
    where: { id: voteInput.id },
    include: { ballots: true },
  });
  if (!vote || vote.resolvedAt) return null;
  const match = matchInput ?? (await loadMatch(matchId));
  if (!match) return null;
  clearVoteTimer(matchId);
  const eventCount = await prisma.matchEvent.count({ where: { matchId } });

  if (match.status !== "playing") {
    const resolved = await prisma.matchVote.update({
      where: { id: vote.id },
      data: { resolvedAt: new Date(), resolvedAtEventCount: eventCount, result: "abandoned" },
    });
    const view = toVoteView({ ...resolved, ballots: vote.ballots }, match);
    broadcastVote(matchId, view);
    return view;
  }

  const eligible = humanSeatIndexes(match);
  const valid = vote.ballots.filter((ballot) => eligible.includes(ballot.seatIndex));
  const opposers = valid.filter((ballot) => ballot.choice === "oppose");
  const result: VoteResult = valid.length === 0 ? "abandoned" : opposers.length > 0 ? "failed" : "passed";
  const resolved = await prisma.matchVote.update({
    where: { id: vote.id },
    data: { resolvedAt: new Date(), resolvedAtEventCount: eventCount, result },
  });
  const view = toVoteView({ ...resolved, ballots: vote.ballots }, match);

  if (result === "failed") {
    broadcastVote(matchId, view);
    return view;
  }
  if (result === "abandoned") {
    broadcastVote(matchId, view);
    await abandonMatchLocked(matchId);
    return view;
  }

  try {
    const finished = await finishMatch(matchId, { allowUnfinished: true, endReason: "endedByVote" });
    broadcastVote(matchId, view);
    dropLiveMatch(matchId);
    clearMatchTimers(matchId);
    broadcastMatchOver(matchId, {
      matchId,
      status: "finished",
      scores: finished.scores,
      endReason: finished.endReason,
    });
    return view;
  } catch (err) {
    console.error(`End vote could not finish match ${matchId}`, err);
    const abandoned = await prisma.matchVote.update({
      where: { id: vote.id },
      data: { resolvedAtEventCount: eventCount, result: "abandoned" },
    });
    broadcastVote(matchId, toVoteView({ ...abandoned, ballots: vote.ballots }, match));
    await abandonMatchLocked(matchId);
    return null;
  }
}

async function abandonMatchLocked(matchId: string): Promise<void> {
  const changed = await prisma.match.updateMany({
    where: { id: matchId, status: "playing" },
    data: { status: "abandoned", endedAt: new Date(), verified: false },
  });
  if (changed.count === 0) return;
  await prisma.matchVote.updateMany({
    where: { matchId, resolvedAt: null },
    data: { resolvedAt: new Date(), result: "abandoned" },
  });
  dropLiveMatch(matchId);
  clearMatchTimers(matchId);
  broadcastMatchOver(matchId, { matchId, status: "abandoned" });
}

export type LeaveResult = "ai" | "abandoned" | "ignored";

export async function leaveOnlineMatch(matchId: string, identity: SessionIdentity): Promise<LeaveResult> {
  if (!identity.userId) {
    throw new HttpError(401, "請先登入", "LOGIN_REQUIRED");
  }
  const result = await withMatchLock(matchId, async () => {
    const match = await loadMatch(matchId);
    if (!match || match.mode !== "online") {
      throw new HttpError(404, "找不到對局", "MATCH_NOT_FOUND");
    }
    if (match.status !== "playing") {
      throw new HttpError(409, "對局已結束，無法離開", "MATCH_NOT_PLAYING");
    }
    const seat = match.participants.find((participant) => participant.userId === identity.userId);
    if (!seat) {
      throw new HttpError(403, "無權存取此對局", "MATCH_FORBIDDEN");
    }
    return releaseSeatToAiLocked(matchId, seat.seatIndex, "leave");
  });
  await ensureRuntime(matchId);
  return result;
}

async function releaseSeatToAiLocked(
  matchId: string,
  seatIndex: number,
  reason: "leave" | "idle",
): Promise<LeaveResult> {
  const match = await loadMatch(matchId);
  if (!match || match.mode !== "online" || match.status !== "playing") return "ignored";
  const seat = match.participants.find((participant) => participant.seatIndex === seatIndex);
  if (!seat || !seat.isHuman || seat.isAi) return "ignored";

  if (humanSeatIndexes(match).length <= 2) {
    await abandonMatchLocked(matchId);
    return "abandoned";
  }

  await prisma.matchParticipant.update({
    where: { id: seat.id },
    data: {
      isHuman: false,
      isAi: true,
      userId: null,
      guestId: null,
      replacedByAiAt: new Date(),
    },
  });
  await prisma.matchVoteBallot.deleteMany({
    where: { seatIndex, vote: { matchId, resolvedAt: null } },
  });
  await markLiveSeatAi(matchId, seatIndex);
  broadcastSeatReplaced(matchId, { matchId, seatIndex, replacedByAi: true, reason });

  const open = await loadOpenVote(matchId);
  if (open) {
    const updatedMatch = (await loadMatch(matchId)) ?? match;
    const eligible = humanSeatIndexes(updatedMatch);
    const valid = open.ballots.filter((ballot) => eligible.includes(ballot.seatIndex));
    const allVoted =
      eligible.length > 0 && eligible.every((index) => valid.some((ballot) => ballot.seatIndex === index));
    if (valid.length === 0 || allVoted) {
      await resolveVoteLocked(matchId, open, updatedMatch);
    } else {
      broadcastVote(matchId, toVoteView(open, updatedMatch));
    }
  }

  const current = await prisma.match.findUnique({ where: { id: matchId }, select: { status: true } });
  if (current?.status === "playing") {
    await broadcastCurrentState(matchId);
    return "ai";
  }
  return current?.status === "abandoned" ? "abandoned" : "ignored";
}

export async function ensureRuntime(matchId: string): Promise<void> {
  let match: MatchWithParticipants | null;
  try {
    match = await loadMatch(matchId);
  } catch {
    return;
  }
  if (!match || match.mode !== "online" || match.status !== "playing") {
    clearMatchTimers(matchId);
    return;
  }
  let open: VoteWithBallots | null;
  try {
    open = await loadOpenVote(matchId);
  } catch {
    return;
  }
  if (open) {
    pauseIdleTimer(matchId);
    clearAiTimer(matchId);
    scheduleVoteExpiry(matchId, open.id, open.deadlineAt);
    return;
  }
  let live: { state: GameState; eventCount: number };
  try {
    live = await getLiveState(matchId);
  } catch {
    return;
  }
  armTimersForState(matchId, match, live.state, false);
}

function armTimersForState(
  matchId: string,
  match: MatchWithParticipants,
  state: GameState,
  resetIdle: boolean,
): void {
  const actor = getActorIndex(state);
  if (actor === null) {
    clearIdleTimer(matchId);
    clearAiTimer(matchId);
    return;
  }
  const participant = match.participants.find((item) => item.seatIndex === actor);
  if (!participant || !participant.isHuman || participant.isAi) {
    clearIdleTimer(matchId);
    pausedIdle.delete(matchId);
    scheduleAiTurn(matchId, actor);
    return;
  }
  clearAiTimer(matchId);
  armIdleTimer(matchId, actor, state.phase.type, resetIdle);
}

function armIdleTimer(matchId: string, seatIndex: number, phaseType: string, reset: boolean): void {
  const existing = idleTimers.get(matchId);
  if (existing && existing.seatIndex === seatIndex && existing.phaseType === phaseType && !reset) return;
  clearIdleTimer(matchId);
  const paused = pausedIdle.get(matchId);
  let ms = idleTurnMs();
  if (paused && paused.seatIndex === seatIndex && paused.phaseType === phaseType) {
    ms = Math.max(0, paused.remainingMs);
    pausedIdle.delete(matchId);
  }
  const deadline = Date.now() + ms;
  const timer = setTimeout(() => {
    void handleIdleTimeout(matchId, seatIndex);
  }, ms);
  timer.unref?.();
  idleTimers.set(matchId, { seatIndex, phaseType, deadline, timer });
}

function pauseIdleTimer(matchId: string): void {
  const existing = idleTimers.get(matchId);
  if (!existing) return;
  clearTimeout(existing.timer);
  idleTimers.delete(matchId);
  pausedIdle.set(matchId, {
    seatIndex: existing.seatIndex,
    phaseType: existing.phaseType,
    remainingMs: Math.max(0, existing.deadline - Date.now()),
  });
}

function clearIdleTimer(matchId: string): void {
  const existing = idleTimers.get(matchId);
  if (existing) clearTimeout(existing.timer);
  idleTimers.delete(matchId);
}

function clearAiTimer(matchId: string): void {
  const existing = aiTimers.get(matchId);
  if (existing) clearTimeout(existing);
  aiTimers.delete(matchId);
}

function clearVoteTimer(matchId: string): void {
  const existing = voteTimers.get(matchId);
  if (existing) clearTimeout(existing);
  voteTimers.delete(matchId);
}

export function clearMatchTimers(matchId: string): void {
  clearIdleTimer(matchId);
  clearAiTimer(matchId);
  clearVoteTimer(matchId);
  pausedIdle.delete(matchId);
}

export function clearAllMatchTimers(): void {
  for (const matchId of new Set([
    ...idleTimers.keys(),
    ...aiTimers.keys(),
    ...voteTimers.keys(),
    ...pausedIdle.keys(),
  ])) {
    clearMatchTimers(matchId);
  }
}

async function handleIdleTimeout(matchId: string, seatIndex: number): Promise<void> {
  try {
    await withMatchLock(matchId, async () => {
      const match = await loadMatch(matchId);
      if (!match || match.mode !== "online" || match.status !== "playing") {
        clearMatchTimers(matchId);
        return;
      }
      const open = await loadOpenVote(matchId);
      if (open) {
        pauseIdleTimer(matchId);
        return;
      }
      const live = await getLiveState(matchId);
      if (getActorIndex(live.state) !== seatIndex) return;
      const seat = match.participants.find((participant) => participant.seatIndex === seatIndex);
      if (!seat || !seat.isHuman || seat.isAi) return;
      await releaseSeatToAiLocked(matchId, seatIndex, "idle");
    });
  } finally {
    void ensureRuntime(matchId);
  }
}

function scheduleAiTurn(matchId: string, seatIndex: number): void {
  clearAiTimer(matchId);
  const timer = setTimeout(() => {
    void runAiTurn(matchId, seatIndex);
  }, aiTurnDelayMs());
  timer.unref?.();
  aiTimers.set(matchId, timer);
}

async function runAiTurn(matchId: string, seatIndex: number): Promise<void> {
  try {
    await withMatchLock(matchId, async () => {
      const match = await loadMatch(matchId);
      if (!match || match.mode !== "online" || match.status !== "playing") {
        clearMatchTimers(matchId);
        return;
      }
      const open = await loadOpenVote(matchId);
      if (open) {
        clearAiTimer(matchId);
        return;
      }
      const live = await getLiveState(matchId);
      if (getActorIndex(live.state) !== seatIndex) return;
      const seat = match.participants.find((participant) => participant.seatIndex === seatIndex);
      if (!seat || seat.isHuman) return;
      const legal = getLegalActions(live.state);
      if (legal.length === 0) return;
      const agent = new HeuristicAgent();
      const action = await agent.chooseAction({
        state: live.state,
        legalActions: legal,
        playerId: live.state.players[seatIndex]!.id,
      });
      const result = await applySeatActionLocked({
        matchId,
        seatIndex,
        action,
        actorUserId: null,
      });
      if (result.gameOver) {
        broadcastMatchState(matchId, {
          state: redactStateForClient(result.state),
          legalActions: [],
          eventCount: result.eventCount,
          vote: null,
        });
        if (result.finish) {
          broadcastMatchOver(matchId, {
            matchId,
            status: "finished",
            scores: result.finish.scores,
            endReason: result.finish.endReason,
          });
        }
        clearMatchTimers(matchId);
        return;
      }
      broadcastMatchState(matchId, {
        state: redactStateForClient(result.state),
        legalActions: result.legalActions,
        eventCount: result.eventCount,
        vote: null,
      });
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2003") {
      // The match was deleted while a queued AI timer fired (e.g. test cleanup).
      return;
    }
    if (
      err instanceof HttpError &&
      (err.code === "MATCH_NOT_FOUND" ||
        err.code === "MATCH_NOT_PLAYING" ||
        err.code === "VOTE_IN_PROGRESS" ||
        err.code === "NOT_YOUR_TURN")
    ) {
      return;
    }
    console.error(`AI turn failed for ${matchId} seat ${seatIndex}`, err);
  } finally {
    void ensureRuntime(matchId);
  }
}

function scheduleVoteExpiry(matchId: string, voteId: string, deadlineAt: Date): void {
  clearVoteTimer(matchId);
  const timer = setTimeout(() => {
    void expireVote(matchId, voteId);
  }, Math.max(0, deadlineAt.getTime() - Date.now()));
  timer.unref?.();
  voteTimers.set(matchId, timer);
}

async function expireVote(matchId: string, voteId: string): Promise<void> {
  try {
    await withMatchLock(matchId, async () => {
      const vote = await prisma.matchVote.findUnique({
        where: { id: voteId },
        include: { ballots: true },
      });
      if (!vote || vote.resolvedAt) return;
      if (vote.deadlineAt.getTime() > Date.now()) {
        scheduleVoteExpiry(matchId, vote.id, vote.deadlineAt);
        return;
      }
      await resolveVoteLocked(matchId, vote);
    });
  } finally {
    void ensureRuntime(matchId);
  }
}

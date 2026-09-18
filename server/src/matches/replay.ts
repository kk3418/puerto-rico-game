import {
  applyAction,
  createInitialState,
  getActorIndex,
  scoreGame,
  type Action,
  type Difficulty,
  type GameState,
  type PlayerCount,
  type ScoreBreakdown,
} from "../../../src/engine";
import { replayCache, type ReplayCache } from "./replayCache";

const ACTION_TYPES = new Set<Action["type"]>([
  "chooseRole",
  "settlerHacienda",
  "settlerTake",
  "mayorPlace",
  "mayorRemove",
  "mayorDone",
  "builderBuild",
  "craftsmanExtra",
  "traderSell",
  "captainLoad",
  "captainPass",
  "captainStore",
]);

export function isAction(value: unknown): value is Action {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof (value as { type: unknown }).type === "string" &&
      ACTION_TYPES.has((value as { type: string }).type as Action["type"]),
  );
}

export type ReplayOk = {
  ok: true;
  state: GameState;
  scores: ScoreBreakdown[];
};

export type ReplayFail = {
  ok: false;
  reason: "illegal" | "not-over" | "empty";
  message: string;
};

export type ReplayResult = ReplayOk | ReplayFail;

export type LiveReplayOk = {
  ok: true;
  state: GameState;
};

export type LiveReplayFail = {
  ok: false;
  reason: "illegal";
  message: string;
};

export function describeActionContext(state: GameState): {
  round: number;
  phaseType: string;
  activeRole: string | null;
  actorSeatIndex: number;
} | null {
  const actorSeatIndex = getActorIndex(state);
  if (actorSeatIndex === null) return null;
  return {
    round: state.round,
    phaseType: state.phase.type,
    activeRole: state.activeRole,
    actorSeatIndex,
  };
}

export function applyNextActions(state: GameState, actions: Action[]): LiveReplayOk | LiveReplayFail {
  try {
    let current = state;
    for (const action of actions) {
      current = applyAction(current, action);
    }
    return { ok: true, state: current };
  } catch (err) {
    const message = err instanceof Error ? err.message : "重放失敗";
    return { ok: false, reason: "illegal", message };
  }
}

export function replayToState(input: {
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  humanName: string;
  actions: Action[];
}): LiveReplayOk | LiveReplayFail {
  const start = createInitialState({
    playerCount: input.playerCount,
    difficulty: input.difficulty,
    seed: input.seed,
    humanName: input.humanName,
  });
  return applyNextActions(start, input.actions);
}

export function replayStoredActions(
  input: {
    matchId: string;
    playerCount: PlayerCount;
    difficulty: Difficulty;
    seed: number;
    humanName: string;
    actions: Action[];
  },
  cache: ReplayCache = replayCache,
): LiveReplayOk | LiveReplayFail {
  const hit = cache.read(input.matchId, input.actions.length);
  if (hit) return { ok: true, state: hit };
  const replayed = replayToState(input);
  if (replayed.ok) cache.write(input.matchId, input.actions.length, replayed.state);
  return replayed;
}

export function replayMatch(input: {
  matchId?: string;
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  humanName: string;
  actions: Action[];
}, cache: ReplayCache = replayCache): ReplayResult {
  if (input.actions.length === 0) {
    return { ok: false, reason: "empty", message: "沒有可重放的事件" };
  }

  const replayed = input.matchId
    ? replayStoredActions({ ...input, matchId: input.matchId }, cache)
    : replayToState(input);
  if (!replayed.ok) return replayed;

  if (!replayed.state.gameOver) {
    return { ok: false, reason: "not-over", message: "重放後對局尚未結束" };
  }

  return { ok: true, state: replayed.state, scores: scoreGame(replayed.state) };
}

export const SAVE_SCHEMA_VERSION = "1.0";

export function parseSchemaMajor(version: string): number | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export function isSupportedSaveSchema(version: string): boolean {
  return parseSchemaMajor(version) === 1;
}

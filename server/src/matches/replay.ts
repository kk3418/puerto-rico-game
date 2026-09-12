import {
  applyAction,
  createInitialState,
  scoreGame,
  type Action,
  type Difficulty,
  type GameState,
  type PlayerCount,
  type ScoreBreakdown,
} from "../../../src/engine";

export function isAction(value: unknown): value is Action {
  return Boolean(value && typeof value === "object" && "type" in value && typeof (value as { type: unknown }).type === "string");
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

export function replayMatch(input: {
  playerCount: PlayerCount;
  difficulty: Difficulty;
  seed: number;
  humanName: string;
  actions: Action[];
}): ReplayResult {
  if (input.actions.length === 0) {
    return { ok: false, reason: "empty", message: "沒有可重放的事件" };
  }

  let state = createInitialState({
    playerCount: input.playerCount,
    difficulty: input.difficulty,
    seed: input.seed,
    humanName: input.humanName,
  });

  try {
    for (const action of input.actions) {
      state = applyAction(state, action);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "重放失敗";
    return { ok: false, reason: "illegal", message };
  }

  if (!state.gameOver) {
    return { ok: false, reason: "not-over", message: "重放後對局尚未結束" };
  }

  return { ok: true, state, scores: scoreGame(state) };
}

export const SAVE_SCHEMA_VERSION = "1.0";

export function parseSchemaMajor(version: string): number | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export function isSupportedSaveSchema(version: string): boolean {
  return parseSchemaMajor(version) === 1;
}

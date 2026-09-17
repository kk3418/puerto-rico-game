import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../../src/agents/heuristic";
import {
  applyAction,
  createInitialState,
  getActorIndex,
  getLegalActions,
  scoreGame,
  type Action,
} from "../../../src/engine";
import { isAction, applyNextActions, describeActionContext, isSupportedSaveSchema, replayMatch, replayStoredActions, replayToState, SAVE_SCHEMA_VERSION } from "./replay";
import { createReplayCache } from "./replayCache";

async function recordGame(seed: number): Promise<{ actions: Action[]; scores: ReturnType<typeof scoreGame> }> {
  let state = createInitialState({
    playerCount: 3,
    difficulty: "balanced",
    seed,
    humanName: "測試者",
  });
  state = {
    ...state,
    players: state.players.map((p) => ({ ...p, isHuman: false })),
  };
  const ai = new HeuristicAgent();
  const actions: Action[] = [];
  let guard = 0;
  while (!state.gameOver && guard++ < 5000) {
    const legal = getLegalActions(state);
    const idx = getActorIndex(state);
    if (legal.length === 0 || idx === null) break;
    const action = await ai.chooseAction({
      state,
      legalActions: legal,
      playerId: state.players[idx]!.id,
    });
    actions.push(action);
    state = applyAction(state, action);
  }
  return { actions, scores: scoreGame(state) };
}

describe("replayMatch", () => {
  it("rejects an empty event list", () => {
    const result = replayMatch({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      actions: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("replays an in-progress match for resume without requiring a save", () => {
    const start = createInitialState({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      governorIndex: 0,
    });
    const first = getLegalActions(start)[0]!;
    const none = replayToState({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      actions: [],
    });
    expect(none.ok).toBe(true);
    if (!none.ok) return;
    expect(none.state.round).toBe(start.round);

    const result = replayToState({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      actions: [first],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gameOver).toBe(false);
    expect(result.state.log.length).toBeGreaterThan(start.log.length);
  });

  it("rejects a game that has not ended", () => {
    const start = createInitialState({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      governorIndex: 0,
    });
    const first = getLegalActions(start)[0]!;
    const result = replayMatch({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      actions: [first],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-over");
  });

  it("replays a finished match and does not trust a client-invented score", async () => {
    const recorded = await recordGame(2024);
    expect(recorded.actions.length).toBeGreaterThan(10);
    const result = replayMatch({
      playerCount: 3,
      difficulty: "balanced",
      seed: 2024,
      humanName: "測試者",
      actions: recorded.actions,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gameOver).toBe(true);
    expect(result.scores.map((s) => s.total)).toEqual(recorded.scores.map((s) => s.total));
    expect(result.scores[0]!.total).not.toBe(9999);
  }, 20000);

  it("accepts the current save schema and rejects an unknown major", () => {
    expect(isSupportedSaveSchema(SAVE_SCHEMA_VERSION)).toBe(true);
    expect(isSupportedSaveSchema("2.0")).toBe(false);
  });
});

describe("describeActionContext", () => {
  it("reads the current actor and phase from engine state", () => {
    const start = createInitialState({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      governorIndex: 0,
    });
    const opening = describeActionContext(start);
    expect(opening).toEqual({
      round: 1,
      phaseType: "chooseRole",
      activeRole: null,
      actorSeatIndex: 0,
    });

    const first = getLegalActions(start)[0]!;
    const after = applyAction(start, first);
    const next = describeActionContext(after);
    expect(next).not.toBeNull();
    expect(next?.actorSeatIndex).toBe(getActorIndex(after));
    expect(next?.phaseType).toBe(after.phase.type);
    expect(next?.activeRole).toBe(after.activeRole);
    expect(next?.round).toBe(after.round);
  });
});

describe("replayStoredActions", () => {
  it("applies new actions onto a cached prefix", () => {
    const cache = createReplayCache();
    const input = {
      playerCount: 3 as const,
      difficulty: "balanced" as const,
      seed: 1,
      humanName: "你",
    };
    const start = createInitialState(input);
    const first = getLegalActions(start)[0]!;
    const mid = applyAction(start, first);
    cache.write("m1", 1, mid);

    const prefix = replayStoredActions({ matchId: "m1", ...input, actions: [first] }, cache);
    expect(prefix.ok).toBe(true);
    if (!prefix.ok) return;
    const second = getLegalActions(prefix.state)[0]!;
    const delta = applyNextActions(prefix.state, [second]);
    const full = replayToState({ ...input, actions: [first, second] });
    expect(delta.ok).toBe(true);
    expect(full.ok).toBe(true);
    if (!delta.ok || !full.ok) return;
    expect(delta.state).toEqual(full.state);
  });
});

describe("isAction", () => {
  it("rejects objects that are not engine actions", () => {
    expect(isAction({ type: "mayorDone" })).toBe(true);
    expect(isAction({ type: "not-a-move" })).toBe(false);
    expect(isAction({ foo: 1 })).toBe(false);

    const start = createInitialState({
      playerCount: 3,
      difficulty: "balanced",
      seed: 1,
      humanName: "你",
      governorIndex: 0,
    });
    const illegal = applyNextActions(start, [{ type: "mayorDone" }]);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.reason).toBe("illegal");
  });
});

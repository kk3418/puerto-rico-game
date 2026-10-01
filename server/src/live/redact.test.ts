import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, getLegalActions } from "../../../src/engine";
import { redactSavedStateForClient, redactStateForClient } from "./redact";

function sampleState() {
  const start = createInitialState({
    playerCount: 3,
    difficulty: "balanced",
    seed: 42,
    humanName: "host",
    seatNames: ["host", "guest-b", "guest-c"],
  });
  const action = getLegalActions(start)[0];
  if (!action) throw new Error("no legal opening action");
  return applyAction(start, action);
}

describe("redactStateForClient", () => {
  it("hides the plantation deck, discard pile, and rng", () => {
    const state = sampleState();
    expect(state.plantationDeck.length).toBeGreaterThan(0);

    const redacted = redactStateForClient(state);
    const payload = JSON.parse(JSON.stringify(redacted)) as Record<string, unknown>;

    expect(payload.plantationDeck).toEqual([]);
    expect(payload.plantationDeckCount).toBe(state.plantationDeck.length);
    expect(payload.plantationDiscard).toEqual([]);
    expect(payload.plantationDiscardCount).toBe(state.plantationDiscard.length);
    expect("rng" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('"rng"');
  });

  it("keeps public information intact", () => {
    const state = sampleState();
    const redacted = redactStateForClient(state);

    expect(redacted.players).toEqual(state.players);
    expect(redacted.faceUpPlantations).toEqual(state.faceUpPlantations);
    expect(redacted.quarrySupply).toBe(state.quarrySupply);
    expect(redacted.roles).toEqual(state.roles);
    expect(redacted.round).toBe(state.round);
    expect(redacted.phase).toEqual(state.phase);
  });

  it("does not mutate the source state", () => {
    const state = sampleState();
    const deckBefore = [...state.plantationDeck];
    redactStateForClient(state);
    expect(state.plantationDeck).toEqual(deckBefore);
    expect(typeof state.rng).toBe("number");
  });
});

describe("redactSavedStateForClient", () => {
  it("redacts online saves and leaves solo saves alone", () => {
    const state = sampleState();
    const json = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;

    const online = redactSavedStateForClient("online", json) as Record<string, unknown>;
    expect(online.plantationDeck).toEqual([]);
    expect(online.plantationDeckCount).toBe(state.plantationDeck.length);
    expect("rng" in online).toBe(false);

    expect(redactSavedStateForClient("solo", json)).toEqual(json);
  });

  it("passes through non-state payloads", () => {
    expect(redactSavedStateForClient("online", { round: 1 })).toEqual({ round: 1 });
    expect(redactSavedStateForClient("online", null)).toBeNull();
  });
});

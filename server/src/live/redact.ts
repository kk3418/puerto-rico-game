import type { GameState, TileType } from "../../../src/engine";

export type RedactedGameState = Omit<GameState, "plantationDeck" | "plantationDiscard" | "rng"> & {
  plantationDeck: TileType[];
  plantationDeckCount: number;
  plantationDiscard: TileType[];
  plantationDiscardCount: number;
};

export function redactStateForClient(state: GameState): RedactedGameState {
  const { rng, plantationDeck, plantationDiscard, ...rest } = state;
  void rng;
  return {
    ...rest,
    plantationDeck: [],
    plantationDeckCount: plantationDeck.length,
    plantationDiscard: [],
    plantationDiscardCount: plantationDiscard.length,
  };
}

/** Online saves keep full state in DB; clients only receive a redacted view. */
export function redactSavedStateForClient(mode: string, stateJson: unknown): unknown {
  if (mode !== "online") return stateJson;
  if (!stateJson || typeof stateJson !== "object" || Array.isArray(stateJson)) return stateJson;
  const record = stateJson as Record<string, unknown>;
  if (!Array.isArray(record.plantationDeck)) return stateJson;
  return redactStateForClient(stateJson as GameState);
}

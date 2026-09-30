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

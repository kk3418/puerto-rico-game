import type { Action, GameState } from "../engine/types";

export interface PlayerAgent {
  chooseAction(input: {
    state: GameState;
    legalActions: Action[];
    playerId: string;
  }): Promise<Action>;
}

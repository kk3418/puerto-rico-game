import type { Action, GameState } from "../engine/types";

export interface PlayerAgent {
  chooseAction(input: {
    state: GameState;
    legalActions: Action[];
    playerId: string;
  }): Promise<Action>;
  /**
   * Extra table-feel pause after a resolved action.
   * Only the local heuristic uses this; an LLM agent should omit it and rely on API latency.
   */
  tablePauseAfterActionMs?(): number;
}

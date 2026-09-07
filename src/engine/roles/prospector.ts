import { pushLog } from "../helpers";
import { completeRole } from "../round";
import type { Action, GameState } from "../types";

export function beginProspector(state: GameState, ownerIndex: number): void {
  const player = state.players[ownerIndex]!;
  player.doubloons += 1;
  pushLog(state, `${player.name}（淘金者）獲得 1 金幣。`);
  completeRole(state);
}

export function legalProspector(_state: GameState): Action[] {
  return [];
}

export function applyProspector(_state: GameState, _action: Action): void {
  // resolved in begin
}

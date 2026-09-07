import { occupiedBuilding, producedAmount, pushLog, takeFromSupply } from "../helpers";
import { completeRole } from "../round";
import type { Action, GameState, Good } from "../types";
import { GOODS } from "../types";

const FACTORY_MONEY = [0, 0, 1, 2, 3, 5];

export function beginCraftsman(state: GameState, ownerIndex: number): void {
  let idx = ownerIndex;
  let ownerProduced: Good[] = [];
  for (let n = 0; n < state.players.length; n++) {
    const player = state.players[idx]!;
    const produced: Good[] = [];
    for (const good of GOODS) {
      const amount = producedAmount(player, good);
      if (amount <= 0) continue;
      const got = takeFromSupply(state, good, amount);
      player.goods[good] += got;
      if (got > 0) produced.push(good);
    }
    if (occupiedBuilding(player, "factory") && produced.length > 0) {
      const money = FACTORY_MONEY[produced.length] ?? 5;
      player.doubloons += money;
      if (money) pushLog(state, `${player.name}的工廠產出 ${money} 金幣。`);
    }
    if (produced.length) {
      pushLog(state, `${player.name}生產了貨物。`);
    }
    if (idx === ownerIndex) ownerProduced = produced;
    idx = (idx + 1) % state.players.length;
  }

  state.phase = { type: "craftsmanPrivilege", actorIndex: ownerIndex, produced: ownerProduced };
}

export function legalCraftsman(state: GameState): Action[] {
  const phase = state.phase;
  if (phase.type !== "craftsmanPrivilege") return [];
  const actions: Action[] = [{ type: "craftsmanExtra", good: null }];
  for (const good of phase.produced) {
    if (state.goodsSupply[good] > 0) {
      actions.push({ type: "craftsmanExtra", good });
    }
  }
  return actions;
}

export function applyCraftsman(state: GameState, action: Action): void {
  if (action.type !== "craftsmanExtra") return;
  const phase = state.phase;
  if (phase.type !== "craftsmanPrivilege") return;
  const player = state.players[phase.actorIndex]!;
  if (action.good && state.goodsSupply[action.good] > 0) {
    state.goodsSupply[action.good] -= 1;
    player.goods[action.good] += 1;
    pushLog(state, `${player.name}（工匠特權）多拿了 1 個貨物。`);
  }
  completeRole(state);
}

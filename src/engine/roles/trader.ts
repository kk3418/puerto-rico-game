import { occupiedBuilding, pushLog, returnGood } from "../helpers";
import { GOOD_PRICE } from "../serialize";
import { completeRole } from "../round";
import type { Action, GameState, Good } from "../types";
import { GOODS } from "../types";

export function beginTrader(state: GameState, ownerIndex: number): void {
  state.phase = { type: "trader", actorIndex: ownerIndex };
}

export function canSell(state: GameState, playerIndex: number, good: Good): boolean {
  const player = state.players[playerIndex]!;
  if (player.goods[good] <= 0) return false;
  if (state.tradingHouse.length >= 4) return false;
  const duplicate = state.tradingHouse.includes(good);
  if (duplicate && !occupiedBuilding(player, "office")) return false;
  return true;
}

export function salePrice(playerIndex: number, state: GameState, good: Good): number {
  const player = state.players[playerIndex]!;
  let price = GOOD_PRICE[good];
  if (occupiedBuilding(player, "smallMarket")) price += 1;
  if (occupiedBuilding(player, "largeMarket")) price += 2;
  if (playerIndex === state.activeRoleOwnerIndex) price += 1;
  return price;
}

export function legalTrader(state: GameState): Action[] {
  const phase = state.phase;
  if (phase.type !== "trader") return [];
  const actions: Action[] = [{ type: "traderSell", good: null }];
  for (const good of GOODS) {
    if (canSell(state, phase.actorIndex, good)) {
      actions.push({ type: "traderSell", good });
    }
  }
  return actions;
}

export function applyTrader(state: GameState, action: Action): void {
  if (action.type !== "traderSell") return;
  const phase = state.phase;
  if (phase.type !== "trader") return;
  const player = state.players[phase.actorIndex]!;
  if (action.good) {
    player.goods[action.good] -= 1;
    state.tradingHouse.push(action.good);
    const price = salePrice(phase.actorIndex, state, action.good);
    player.doubloons += price;
    pushLog(state, `${player.name}賣出貨物，獲得 ${price} 金幣。`);
  }
  const next = (phase.actorIndex + 1) % state.players.length;
  if (next === state.activeRoleOwnerIndex) {
    if (state.tradingHouse.length >= 4) {
      for (const good of state.tradingHouse) returnGood(state, good, 1);
      state.tradingHouse = [];
      pushLog(state, "交易屋已滿，貨物回到供應堆。");
    }
    completeRole(state);
    return;
  }
  state.phase = { type: "trader", actorIndex: next };
}

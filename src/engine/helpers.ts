import { getBuilding } from "./buildings";
import { shuffleInPlace } from "./rng";
import type { Action, BuildingId, GameState, Good, PlayerState, Role, TileType } from "./types";
import { GOODS } from "./types";

export const ISLAND_SPACES = 12;
export const CITY_SPACES = 12;

export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function emptyGoods(): Record<Good, number> {
  return { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 };
}

export function citySpacesUsed(player: PlayerState): number {
  return player.city.reduce((sum, b) => sum + getBuilding(b.buildingId).citySpaces, 0);
}

export function citySpacesLeft(player: PlayerState): number {
  return CITY_SPACES - citySpacesUsed(player);
}

export function islandSpacesLeft(player: PlayerState): number {
  return ISLAND_SPACES - player.island.length;
}

export function hasBuilding(player: PlayerState, id: BuildingId): boolean {
  return player.city.some((b) => b.buildingId === id);
}

export function occupiedBuilding(player: PlayerState, id: BuildingId): boolean {
  return player.city.some((b) => b.buildingId === id && b.colonists > 0);
}

export function occupiedQuarries(player: PlayerState): number {
  return player.island.filter((t) => t.type === "quarry" && t.colonists > 0).length;
}

export function totalColonists(player: PlayerState): number {
  const onIsland = player.island.reduce((s, t) => s + t.colonists, 0);
  const onCity = player.city.reduce((s, b) => s + b.colonists, 0);
  return onIsland + onCity + player.sanJuan + player.unplacedColonists;
}

export function emptyBuildingCircles(player: PlayerState): number {
  return player.city.reduce((sum, b) => {
    const cap = getBuilding(b.buildingId).circles;
    return sum + Math.max(0, cap - b.colonists);
  }, 0);
}

export function nextIndex(state: GameState, from: number): number {
  return (from + 1) % state.players.length;
}

export function playerById(state: GameState, id: string): PlayerState {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error(`Unknown player ${id}`);
  return player;
}

export function goodCount(player: PlayerState): number {
  return GOODS.reduce((s, g) => s + player.goods[g], 0);
}

export function actionsEqual(a: Action, b: Action): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function isLegalAction(_state: GameState, action: Action, legal: Action[]): boolean {
  return legal.some((item) => actionsEqual(item, action));
}

export function takeFromSupply(state: GameState, good: Good, amount: number): number {
  const got = Math.min(amount, state.goodsSupply[good]);
  state.goodsSupply[good] -= got;
  return got;
}

export function returnGood(state: GameState, good: Good, amount: number): void {
  state.goodsSupply[good] += amount;
}

export function takeColonists(state: GameState, amount: number): number {
  const got = Math.min(amount, state.colonistSupply);
  state.colonistSupply -= got;
  return got;
}

/** Hospice / University: supply first, then colonist ship. */
export function takeColonistFromSupplyOrShip(state: GameState): number {
  if (state.colonistSupply > 0) {
    state.colonistSupply -= 1;
    return 1;
  }
  if (state.colonistShip > 0) {
    state.colonistShip -= 1;
    return 1;
  }
  return 0;
}

export function awardVp(state: GameState, player: PlayerState, amount: number): void {
  if (amount <= 0) return;
  player.vpChips += amount;
  state.vpSupply = Math.max(0, state.vpSupply - amount);
  if (state.vpSupply === 0) {
    triggerEnd(state, "勝利分籌碼用盡");
  }
}

export function triggerEnd(state: GameState, reason: string): void {
  if (!state.endTriggered) {
    state.endTriggered = true;
    state.endReason = reason;
    pushLog(state, `終局條件觸發：${reason}。本輪總督回合結束後結算。`);
  }
}

export function pushLog(state: GameState, text: string): void {
  state.logSeq += 1;
  state.log.push({ id: state.logSeq, text });
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
}

export function warehouseTypes(player: PlayerState): number {
  let n = 0;
  if (occupiedBuilding(player, "smallWarehouse")) n += 1;
  if (occupiedBuilding(player, "largeWarehouse")) n += 2;
  return n;
}

export function producedAmount(player: PlayerState, good: Good): number {
  const plantations = player.island.filter((t) => t.type === good && t.colonists > 0).length;
  if (good === "corn") return plantations;
  const circles = player.city.reduce((sum, b) => {
    const def = getBuilding(b.buildingId);
    if (def.good === good) return sum + b.colonists;
    return sum;
  }, 0);
  return Math.min(plantations, circles);
}

export function canTakeQuarry(state: GameState, player: PlayerState, isSettlerOwner: boolean): boolean {
  if (state.quarrySupply <= 0) return false;
  if (islandSpacesLeft(player) <= 0) return false;
  return isSettlerOwner || occupiedBuilding(player, "constructionHut");
}

export function drawPlantations(state: GameState, count: number): TileType[] {
  const drawn: TileType[] = [];
  for (let i = 0; i < count; i++) {
    if (state.plantationDeck.length === 0) {
      if (state.plantationDiscard.length === 0) break;
      state.plantationDeck = state.plantationDiscard;
      state.plantationDiscard = [];
      state.rng = shuffleInPlace(state.plantationDeck, state.rng);
    }
    const tile = state.plantationDeck.pop();
    if (tile) drawn.push(tile);
  }
  return drawn;
}

export function refillFaceUp(state: GameState): void {
  state.plantationDiscard.push(...state.faceUpPlantations);
  state.faceUpPlantations = [];
  const need = state.playerCount + 1;
  state.faceUpPlantations = drawPlantations(state, need);
}

export function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const result: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      result.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return result;
}

export function subsetsUpTo<T>(items: T[], max: number): T[][] {
  const out: T[][] = [[]];
  const limit = Math.min(max, items.length);
  for (let k = 1; k <= limit; k++) out.push(...combinations(items, k));
  return out;
}

export function actorIndex(state: GameState): number | null {
  const phase = state.phase;
  if (phase.type === "chooseRole") return state.chooserIndex;
  if (phase.type === "gameOver") return null;
  if ("actorIndex" in phase) return phase.actorIndex;
  return null;
}

export function chosenRoleFor(state: GameState, playerIndex: number): Role | null {
  return state.roles.find((slot) => slot.takenBy === playerIndex)?.role ?? null;
}

import { applyAction } from "../engine/reduce";
import { nextUnit } from "../engine/rng";
import { buildingPrintedVp, scorePlayer } from "../engine/scoring";
import { occupiedQuarries, producedAmount, totalColonists } from "../engine/helpers";
import { GOODS, type Action, type GameState, type Good, type PlayerState } from "../engine/types";
import type { PlayerAgent } from "./types";

export class HeuristicAgent implements PlayerAgent {
  async chooseAction(input: {
    state: GameState;
    legalActions: Action[];
    playerId: string;
  }): Promise<Action> {
    const { state, legalActions, playerId } = input;
    if (legalActions.length === 0) {
      throw new Error("No legal actions");
    }
    if (legalActions.length === 1) return legalActions[0]!;

    const playerIndex = state.players.findIndex((p) => p.id === playerId);
    const scored = legalActions.map((action) => ({
      action,
      score: scoreAction(state, action, playerIndex),
    }));
    scored.sort((a, b) => b.score - a.score);

    let rng = state.rng;
    const roll = nextUnit(rng);
    const aggressive = state.difficulty === "aggressive";
    const randomize = !aggressive && roll.value < 0.12 && scored.length > 1;
    return randomize ? scored[1]!.action : scored[0]!.action;
  }
}

function scoreAction(state: GameState, action: Action, playerIndex: number): number {
  let bonus = 0;
  if (action.type === "chooseRole") {
    bonus += scoreRolePrior(state, action.roleId, playerIndex);
  }
  if (action.type === "settlerTake" && action.source === "quarry") bonus += 6;
  if (action.type === "builderBuild" && action.buildingId) {
    bonus += 4;
  }
  if (action.type === "traderSell" && action.good) {
    const prices: Record<Good, number> = { corn: 0, indigo: 1, sugar: 2, tobacco: 3, coffee: 4 };
    bonus += prices[action.good] * 3;
  }
  if (action.type === "captainLoad") {
    bonus += 8;
    if (action.destination === "wharf") bonus -= 1;
  }
  if (action.type === "mayorPlace") {
    bonus += scoreMayorPlace(state.players[playerIndex]!, action);
  }
  if (action.type === "craftsmanExtra" && action.good) {
    const prices: Record<Good, number> = { corn: 0.5, indigo: 1, sugar: 2, tobacco: 3, coffee: 4 };
    bonus += prices[action.good];
  }

  try {
    const next = applyAction(state, action);
    return bonus + evaluateState(next, playerIndex);
  } catch {
    return bonus - 100;
  }
}

function scoreRolePrior(state: GameState, roleId: string, playerIndex: number): number {
  const player = state.players[playerIndex]!;
  const slot = state.roles.find((r) => r.id === roleId);
  if (!slot) return 0;
  let score = slot.doubloons * 4;
  const goods = GOODS.reduce((s, g) => s + player.goods[g], 0);
  const prod = GOODS.reduce((s, g) => s + producedAmount(player, g), 0);
  switch (slot.role) {
    case "captain":
      score += goods * 3;
      break;
    case "craftsman":
      score += prod * 3;
      break;
    case "trader":
      score += player.goods.coffee * 5 + player.goods.tobacco * 4 + player.goods.sugar * 2;
      break;
    case "builder":
      score += player.doubloons * 1.2 + occupiedQuarries(player) * 3;
      break;
    case "mayor":
      score += 4 + player.city.length * 1.5;
      break;
    case "settler":
      score += player.island.length < 12 ? 5 : 0;
      break;
    case "prospector":
      score += 3 + (player.doubloons < 3 ? 3 : 0);
      break;
  }
  return score;
}

function scoreMayorPlace(player: PlayerState, action: Extract<Action, { type: "mayorPlace" }>): number {
  const target = action.target;
  if (target.kind === "building") {
    const b = player.city.find((x) => x.instanceId === target.instanceId);
    if (!b) return 0;
    const id = b.buildingId;
    if (id.includes("Indigo") || id.includes("Sugar") || id === "tobaccoStorage" || id === "coffeeRoaster") return 9;
    if (id === "factory" || id === "harbor" || id === "wharf" || id === "university") return 8;
    if (id === "guildHall" || id === "residence" || id === "fortress" || id === "customsHouse" || id === "cityHall")
      return 7;
    return 5;
  }
  if (target.kind === "island") {
    const tile = player.island[target.index];
    if (tile?.type === "quarry") return 6;
    return 4;
  }
  return 0;
}

function evaluateState(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex]!;
  const others = state.players.filter((_, i) => i !== playerIndex);
  const self = scorePlayer(player).total * 4 + buildingPrintedVp(player);
  const gold = player.doubloons * 1.4;
  const goods = GOODS.reduce((s, g) => s + player.goods[g] * (g === "corn" ? 0.4 : 1), 0);
  const board = player.island.length * 0.6 + player.city.length * 1.2 + occupiedQuarries(player) * 2;
  const people = totalColonists(player) * 0.35;
  const oppVp = others.reduce((s, p) => s + p.vpChips, 0) * 0.8;
  return self + gold + goods + board + people - oppVp;
}

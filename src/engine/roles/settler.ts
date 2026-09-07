import {
  canTakeQuarry,
  drawPlantations,
  islandSpacesLeft,
  occupiedBuilding,
  pushLog,
  refillFaceUp,
  takeColonistFromSupplyOrShip,
} from "../helpers";
import { completeRole } from "../round";
import type { Action, GameState, TileType } from "../types";

function hospiceColonist(state: GameState, playerIndex: number, tileIndex: number): void {
  const player = state.players[playerIndex]!;
  if (!occupiedBuilding(player, "hospice")) return;
  const got = takeColonistFromSupplyOrShip(state);
  if (got === 1) {
    player.island[tileIndex]!.colonists = 1;
  }
}

function addTile(state: GameState, playerIndex: number, tile: TileType, useHospice: boolean): void {
  const player = state.players[playerIndex]!;
  player.island.push({ type: tile, colonists: 0 });
  if (useHospice) hospiceColonist(state, playerIndex, player.island.length - 1);
}

export function beginSettler(state: GameState, ownerIndex: number): void {
  startSettlerPlayer(state, ownerIndex);
}

function startSettlerPlayer(state: GameState, actorIndex: number): void {
  const player = state.players[actorIndex]!;
  if (occupiedBuilding(player, "hacienda") && islandSpacesLeft(player) > 0 && (state.plantationDeck.length > 0 || state.plantationDiscard.length > 0)) {
    state.phase = { type: "settlerHacienda", actorIndex };
    return;
  }
  state.phase = { type: "settlerTake", actorIndex };
}

export function legalSettler(state: GameState): Action[] {
  const phase = state.phase;
  if (phase.type === "settlerHacienda") {
    return [
      { type: "settlerHacienda", take: true },
      { type: "settlerHacienda", take: false },
    ];
  }
  if (phase.type !== "settlerTake") return [];
  const actor = state.players[phase.actorIndex]!;
  const actions: Action[] = [{ type: "settlerTake", source: "pass" }];
  if (islandSpacesLeft(actor) > 0) {
    state.faceUpPlantations.forEach((_, index) => {
      actions.push({ type: "settlerTake", source: "faceUp", index });
    });
    const isOwner = phase.actorIndex === state.activeRoleOwnerIndex;
    if (canTakeQuarry(state, actor, isOwner)) {
      actions.push({ type: "settlerTake", source: "quarry" });
    }
  }
  return actions;
}

export function applySettler(state: GameState, action: Action): void {
  if (action.type === "settlerHacienda") {
    const phase = state.phase;
    if (phase.type !== "settlerHacienda") return;
    const player = state.players[phase.actorIndex]!;
    if (action.take && islandSpacesLeft(player) > 0) {
      const [tile] = drawPlantations(state, 1);
      if (tile) {
        addTile(state, phase.actorIndex, tile, false);
        pushLog(state, `${player.name}以莊園抽到${tileName(tile)}。`);
      }
    }
    state.phase = { type: "settlerTake", actorIndex: phase.actorIndex };
    return;
  }

  if (action.type !== "settlerTake") return;
  const phase = state.phase;
  if (phase.type !== "settlerTake") return;
  const player = state.players[phase.actorIndex]!;

  if (action.source === "faceUp") {
    const tile = state.faceUpPlantations[action.index];
    if (tile && islandSpacesLeft(player) > 0) {
      state.faceUpPlantations.splice(action.index, 1);
      addTile(state, phase.actorIndex, tile, true);
      pushLog(state, `${player.name}拿了${tileName(tile)}。`);
    }
  } else if (action.source === "quarry") {
    if (state.quarrySupply > 0 && islandSpacesLeft(player) > 0) {
      state.quarrySupply -= 1;
      addTile(state, phase.actorIndex, "quarry", true);
      pushLog(state, `${player.name}拿了採石場。`);
    }
  }

  nextSettler(state, phase.actorIndex);
}

function nextSettler(state: GameState, current: number): void {
  const next = (current + 1) % state.players.length;
  if (next === state.activeRoleOwnerIndex) {
    refillFaceUp(state);
    completeRole(state);
    return;
  }
  startSettlerPlayer(state, next);
}

function tileName(tile: TileType): string {
  const names: Record<TileType, string> = {
    corn: "玉米田",
    indigo: "靛藍田",
    sugar: "甘蔗田",
    tobacco: "菸草田",
    coffee: "咖啡田",
    quarry: "採石場",
  };
  return names[tile];
}

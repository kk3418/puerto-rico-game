import { BUILDING_IDS, getBuilding } from "../buildings";
import {
  citySpacesLeft,
  hasBuilding,
  occupiedBuilding,
  occupiedQuarries,
  pushLog,
  takeColonistFromSupplyOrShip,
} from "../helpers";
import { checkCityFull } from "../scoring";
import { completeRole } from "../round";
import type { Action, BuildingId, GameState, PlayerState } from "../types";

export function builderCost(player: PlayerState, buildingId: BuildingId, privilege: boolean): number {
  const def = getBuilding(buildingId);
  const quarry = Math.min(occupiedQuarries(player), def.quarryColumn);
  const extra = privilege ? 1 : 0;
  return Math.max(0, def.cost - quarry - extra);
}

export function canBuild(state: GameState, player: PlayerState, buildingId: BuildingId, privilege: boolean): boolean {
  if ((state.buildingSupply[buildingId] ?? 0) <= 0) return false;
  if (hasBuilding(player, buildingId)) return false;
  const def = getBuilding(buildingId);
  if (citySpacesLeft(player) < def.citySpaces) return false;
  return player.doubloons >= builderCost(player, buildingId, privilege);
}

export function beginBuilder(state: GameState, ownerIndex: number): void {
  state.phase = { type: "builder", actorIndex: ownerIndex };
}

export function legalBuilder(state: GameState): Action[] {
  const phase = state.phase;
  if (phase.type !== "builder") return [];
  const player = state.players[phase.actorIndex]!;
  const privilege = phase.actorIndex === state.activeRoleOwnerIndex;
  const actions: Action[] = [{ type: "builderBuild", buildingId: null }];
  for (const id of BUILDING_IDS) {
    if (canBuild(state, player, id, privilege)) {
      actions.push({ type: "builderBuild", buildingId: id });
    }
  }
  return actions;
}

export function applyBuilder(state: GameState, action: Action): void {
  if (action.type !== "builderBuild") return;
  const phase = state.phase;
  if (phase.type !== "builder") return;
  const player = state.players[phase.actorIndex]!;
  const privilege = phase.actorIndex === state.activeRoleOwnerIndex;

  if (action.buildingId) {
    const id = action.buildingId;
    const cost = builderCost(player, id, privilege);
    player.doubloons -= cost;
    state.buildingSupply[id] -= 1;
    const instanceId = `b${state.nextInstanceId}`;
    state.nextInstanceId += 1;
    const building = { instanceId, buildingId: id, colonists: 0 };
    if (occupiedBuilding(player, "university")) {
      building.colonists = takeColonistFromSupplyOrShip(state);
    }
    player.city.push(building);
    const def = getBuilding(id);
    pushLog(state, `${player.name}花費 ${cost} 金幣建造${def.nameZh}。`);
    checkCityFull(state);
  }

  const next = (phase.actorIndex + 1) % state.players.length;
  if (next === state.activeRoleOwnerIndex) {
    completeRole(state);
    return;
  }
  state.phase = { type: "builder", actorIndex: next };
}

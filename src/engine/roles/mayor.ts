import { getBuilding } from "../buildings";
import { emptyBuildingCircles, pushLog, takeColonists, triggerEnd } from "../helpers";
import { completeRole } from "../round";
import type { Action, GameState } from "../types";

export function beginMayor(state: GameState, ownerIndex: number): void {
  for (const player of state.players) {
    player.unplacedColonists += player.sanJuan;
    player.sanJuan = 0;
  }

  const owner = state.players[ownerIndex]!;
  const extra = takeColonists(state, 1);
  owner.sanJuan += extra;
  if (extra) pushLog(state, `${owner.name}（市長特權）多拿 1 名殖民者。`);

  let remaining = state.colonistShip;
  let idx = ownerIndex;
  while (remaining > 0) {
    state.players[idx]!.sanJuan += 1;
    remaining -= 1;
    idx = (idx + 1) % state.players.length;
  }
  state.colonistShip = 0;
  startAssign(state, ownerIndex);
}

function startAssign(state: GameState, actorIndex: number): void {
  const player = state.players[actorIndex]!;
  const received = player.sanJuan;
  const pool = received + player.unplacedColonists;
  player.sanJuan = 0;
  player.unplacedColonists = pool;
  state.phase = { type: "mayorAssign", actorIndex, received };
}

export function legalMayor(state: GameState): Action[] {
  const phase = state.phase;
  if (phase.type !== "mayorAssign") return [];
  const player = state.players[phase.actorIndex]!;
  const actions: Action[] = [];

  if (player.unplacedColonists > 0) {
    player.island.forEach((tile, index) => {
      if (tile.colonists === 0) {
        actions.push({ type: "mayorPlace", target: { kind: "island", index } });
      }
    });
    for (const b of player.city) {
      if (b.colonists < getBuilding(b.buildingId).circles) {
        actions.push({ type: "mayorPlace", target: { kind: "building", instanceId: b.instanceId } });
      }
    }
  }

  player.island.forEach((tile, index) => {
    if (tile.colonists > 0) {
      actions.push({ type: "mayorRemove", target: { kind: "island", index } });
    }
  });
  for (const b of player.city) {
    if (b.colonists > 0) {
      actions.push({ type: "mayorRemove", target: { kind: "building", instanceId: b.instanceId } });
    }
  }

  const openIsland = player.island.some((t) => t.colonists === 0);
  const openBuilding = player.city.some((b) => b.colonists < getBuilding(b.buildingId).circles);
  if (player.unplacedColonists > 0 && !openIsland && !openBuilding) {
    actions.push({ type: "mayorPlace", target: { kind: "sanJuan" } });
  }
  if (player.unplacedColonists <= 0 || (!openIsland && !openBuilding)) {
    actions.push({ type: "mayorDone" });
  }
  return actions;
}

export function applyMayor(state: GameState, action: Action): void {
  const phase = state.phase;
  if (phase.type !== "mayorAssign") return;
  const player = state.players[phase.actorIndex]!;

  if (action.type === "mayorDone") {
    finishMayorPlayer(state, phase.actorIndex);
    return;
  }

  if (action.type === "mayorRemove") {
    const target = action.target;
    if (target.kind === "island") {
      const tile = player.island[target.index];
      if (!tile || tile.colonists <= 0) return;
      tile.colonists -= 1;
    } else {
      const building = player.city.find((item) => item.instanceId === target.instanceId);
      if (!building || building.colonists <= 0) return;
      building.colonists -= 1;
    }
    player.unplacedColonists += 1;
    return;
  }

  if (action.type === "mayorPlace" && player.unplacedColonists > 0) {
    const target = action.target;
    if (target.kind === "island") {
      const tile = player.island[target.index];
      if (!tile || tile.colonists !== 0) return;
      tile.colonists = 1;
    } else if (target.kind === "building") {
      const building = player.city.find((item) => item.instanceId === target.instanceId);
      if (!building || building.colonists >= getBuilding(building.buildingId).circles) return;
      building.colonists += 1;
    } else {
      player.sanJuan += 1;
    }
    player.unplacedColonists -= 1;
  }
}

function finishMayorPlayer(state: GameState, current: number): void {
  const player = state.players[current]!;
  player.sanJuan += player.unplacedColonists;
  player.unplacedColonists = 0;
  const next = (current + 1) % state.players.length;
  if (next === state.activeRoleOwnerIndex) {
    refillColonistShip(state);
    completeRole(state);
    return;
  }
  startAssign(state, next);
}

function refillColonistShip(state: GameState): void {
  const empty = state.players.reduce((s, p) => s + emptyBuildingCircles(p), 0);
  const need = Math.max(empty, state.playerCount);
  const got = takeColonists(state, need);
  state.colonistShip = got;
  if (got < need) {
    triggerEnd(state, "殖民者供應耗盡，無法補滿殖民船");
  }
  pushLog(state, `殖民船補了 ${got} 名殖民者。`);
}

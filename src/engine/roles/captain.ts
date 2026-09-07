import { awardVp, goodCount, occupiedBuilding, pushLog, returnGood, subsetsUpTo, warehouseTypes } from "../helpers";
import { completeRole } from "../round";
import type { Action, GameState, PlayerState } from "../types";
import { GOODS } from "../types";

export function beginCaptain(state: GameState, ownerIndex: number): void {
  const phase = {
    type: "captainLoad" as const,
    actorIndex: ownerIndex,
    passes: 0,
    wharfUsed: [] as string[],
    privilegeUsed: false,
  };
  state.phase = phase;
  skipIfCannotAct(state);
}

function currentLoadPhase(state: GameState) {
  const phase = state.phase;
  return phase.type === "captainLoad" ? phase : null;
}

export function realShipLoads(state: GameState, player: PlayerState): Action[] {
  const actions: Action[] = [];
  for (const good of GOODS) {
    if (player.goods[good] <= 0) continue;
    const otherHasType = state.ships.some((s) => s.good === good && s.loaded > 0);
    const candidates: { index: number; amount: number }[] = [];
    state.ships.forEach((ship, index) => {
      const space = ship.capacity - ship.loaded;
      if (space <= 0) return;
      if (ship.good === good || (ship.good === null && ship.loaded === 0 && !otherHasType)) {
        candidates.push({ index, amount: Math.min(player.goods[good], space) });
      }
    });
    const best = candidates.reduce((m, c) => Math.max(m, c.amount), 0);
    for (const c of candidates) {
      if (c.amount === best && best > 0) {
        actions.push({ type: "captainLoad", good, destination: c.index });
      }
    }
  }
  return actions;
}

export function wharfLoads(state: GameState, player: PlayerState): Action[] {
  const phase = currentLoadPhase(state);
  if (!phase) return [];
  if (!occupiedBuilding(player, "wharf")) return [];
  if (phase.wharfUsed.includes(player.id)) return [];
  return GOODS.filter((g) => player.goods[g] > 0).map((good) => ({
    type: "captainLoad" as const,
    good,
    destination: "wharf" as const,
  }));
}

export function legalCaptain(state: GameState): Action[] {
  const phase = state.phase;
  if (phase.type === "captainStore") return legalStore(state);
  if (phase.type !== "captainLoad") return [];
  const player = state.players[phase.actorIndex]!;
  const ships = realShipLoads(state, player);
  const wharf = wharfLoads(state, player);
  if (ships.length > 0) return [...ships, ...wharf];
  return [...wharf, { type: "captainPass" }];
}

export function applyCaptain(state: GameState, action: Action): void {
  if (action.type === "captainStore") {
    applyStore(state, action);
    return;
  }
  const phase = currentLoadPhase(state);
  if (!phase) return;
  const player = state.players[phase.actorIndex]!;

  if (action.type === "captainPass") {
    phase.passes += 1;
    if (phase.passes >= state.players.length) {
      beginStore(state);
      return;
    }
    phase.actorIndex = (phase.actorIndex + 1) % state.players.length;
    skipIfCannotAct(state);
    return;
  }

  if (action.type !== "captainLoad") return;

  if (action.destination === "wharf") {
    const amount = Math.min(player.goods[action.good], 11);
    player.goods[action.good] -= amount;
    returnGood(state, action.good, amount);
    phase.wharfUsed.push(player.id);
    scoreShipment(state, player, amount, phase);
    pushLog(state, `${player.name}以碼頭裝運 ${amount} 桶。`);
  } else {
    const ship = state.ships[action.destination];
    if (!ship) return;
    const space = ship.capacity - ship.loaded;
    const amount = Math.min(player.goods[action.good], space);
    player.goods[action.good] -= amount;
    ship.good = action.good;
    ship.loaded += amount;
    scoreShipment(state, player, amount, phase);
    pushLog(state, `${player.name}裝船 ${amount} 桶。`);
  }

  phase.passes = 0;
  phase.actorIndex = (phase.actorIndex + 1) % state.players.length;
  skipIfCannotAct(state);
}

function scoreShipment(
  state: GameState,
  player: PlayerState,
  amount: number,
  phase: { privilegeUsed: boolean },
): void {
  let vp = amount;
  if (occupiedBuilding(player, "harbor")) vp += 1;
  if (player.id === state.players[state.activeRoleOwnerIndex ?? 0]?.id && !phase.privilegeUsed) {
    vp += 1;
    phase.privilegeUsed = true;
  }
  awardVp(state, player, vp);
}

function skipIfCannotAct(state: GameState): void {
  const phase = currentLoadPhase(state);
  if (!phase) return;
  let guard = 0;
  while (guard++ < state.players.length + 1) {
    const player = state.players[phase.actorIndex]!;
    const ships = realShipLoads(state, player);
    const wharf = wharfLoads(state, player);
    if (ships.length > 0) return;
    if (wharf.length > 0) return;
    phase.passes += 1;
    if (phase.passes >= state.players.length) {
      beginStore(state);
      return;
    }
    phase.actorIndex = (phase.actorIndex + 1) % state.players.length;
  }
}

function beginStore(state: GameState): void {
  const owner = state.activeRoleOwnerIndex ?? 0;
  const order = state.players.map((_, i) => (owner + i) % state.players.length);
  processStoreOrder(state, order);
}

function processStoreOrder(state: GameState, order: number[]): void {
  const queue = [...order];
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const player = state.players[idx]!;
    const options = legalStoreFor(player);
    if (goodCount(player) > 0 && options.length > 1) {
      state.phase = { type: "captainStore", actorIndex: idx, rest: queue };
      return;
    }
    if (options.length === 1) {
      const only = options[0]!;
      if (only.type === "captainStore") applyStoreAt(state, player, only);
    }
  }
  emptyFullShips(state);
  completeRole(state);
}

function emptyFullShips(state: GameState): void {
  for (const ship of state.ships) {
    if (ship.good && ship.loaded >= ship.capacity) {
      returnGood(state, ship.good, ship.loaded);
      pushLog(state, `滿載的貨船卸下 ${ship.loaded} 桶${ship.good}。`);
      ship.good = null;
      ship.loaded = 0;
    }
  }
}

function legalStore(state: GameState): Action[] {
  const phase = state.phase;
  if (phase.type !== "captainStore") return [];
  return legalStoreFor(state.players[phase.actorIndex]!);
}

function legalStoreFor(player: PlayerState): Action[] {
  if (goodCount(player) === 0) return [];
  const types = GOODS.filter((g) => player.goods[g] > 0);
  const w = warehouseTypes(player);
  const actions: Action[] = [];
  for (const keepTypes of subsetsUpTo(types, w)) {
    const leftoverTypes = types.filter((g) => !keepTypes.includes(g));
    const leftoverCount = leftoverTypes.reduce((s, g) => s + player.goods[g], 0);
    if (leftoverCount <= 0) {
      actions.push({ type: "captainStore", keepTypes, extra: null });
    } else {
      for (const extra of leftoverTypes) {
        actions.push({ type: "captainStore", keepTypes, extra });
      }
    }
  }
  return actions;
}

function applyStore(state: GameState, action: Extract<Action, { type: "captainStore" }>): void {
  const phase = state.phase;
  if (phase.type !== "captainStore") return;
  const player = state.players[phase.actorIndex]!;
  applyStoreAt(state, player, action);
  processStoreOrder(state, phase.rest);
}

function applyStoreAt(
  state: GameState,
  player: PlayerState,
  action: Extract<Action, { type: "captainStore" }>,
): void {
  for (const good of GOODS) {
    if (action.keepTypes.includes(good)) continue;
    let dump = player.goods[good];
    if (action.extra === good && dump > 0) dump -= 1;
    player.goods[good] -= dump;
    if (dump > 0) returnGood(state, good, dump);
  }
}

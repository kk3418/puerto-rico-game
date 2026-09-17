import { getBuilding } from "./buildings";
import { CITY_SPACES, citySpacesUsed, occupiedBuilding, totalColonists, triggerEnd } from "./helpers";
import type { GameState, PlayerState, ScoreBreakdown } from "./types";
import { GOODS } from "./types";

export function buildingPrintedVp(player: PlayerState): number {
  return player.city.reduce((sum, b) => sum + getBuilding(b.buildingId).vp, 0);
}

export function guildHallBonus(player: PlayerState): number {
  if (!occupiedBuilding(player, "guildHall")) return 0;
  let extra = 0;
  for (const b of player.city) {
    const def = getBuilding(b.buildingId);
    if (def.kind === "productionSmall") extra += 1;
    if (def.kind === "productionLarge") extra += 2;
  }
  return extra;
}

export function residenceBonus(player: PlayerState): number {
  if (!occupiedBuilding(player, "residence")) return 0;
  const filled = player.island.length;
  if (filled >= 12) return 7;
  if (filled >= 11) return 6;
  if (filled >= 10) return 5;
  return 4;
}

export function fortressBonus(player: PlayerState): number {
  if (!occupiedBuilding(player, "fortress")) return 0;
  return Math.floor(totalColonists(player) / 3);
}

export function customsHouseBonus(player: PlayerState): number {
  if (!occupiedBuilding(player, "customsHouse")) return 0;
  return Math.floor(player.vpChips / 4);
}

export function cityHallBonus(player: PlayerState): number {
  if (!occupiedBuilding(player, "cityHall")) return 0;
  return player.city.reduce((sum, b) => {
    const kind = getBuilding(b.buildingId).kind;
    return kind === "violet" || kind === "large" ? sum + 1 : sum;
  }, 0);
}

export function scorePlayer(player: PlayerState): ScoreBreakdown {
  const vpChips = player.vpChips;
  const buildingVp = buildingPrintedVp(player);
  const guildHall = guildHallBonus(player);
  const residence = residenceBonus(player);
  const fortress = fortressBonus(player);
  const customsHouse = customsHouseBonus(player);
  const cityHall = cityHallBonus(player);
  return {
    playerId: player.id,
    name: player.name,
    vpChips,
    buildingVp,
    guildHall,
    residence,
    fortress,
    customsHouse,
    cityHall,
    total: vpChips + buildingVp + guildHall + residence + fortress + customsHouse + cityHall,
    goodsAndGold: goodsAndGold(player),
  };
}

export function goodsAndGold(player: PlayerState): number {
  return player.doubloons + GOODS.reduce((sum, g) => sum + player.goods[g], 0);
}

export function scoreGame(state: GameState): ScoreBreakdown[] {
  return state.players
    .map(scorePlayer)
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const pa = state.players.find((p) => p.id === a.playerId)!;
      const pb = state.players.find((p) => p.id === b.playerId)!;
      return goodsAndGold(pb) - goodsAndGold(pa);
    });
}

export function checkCityFull(state: GameState): void {
  for (const player of state.players) {
    if (citySpacesUsed(player) >= CITY_SPACES) {
      triggerEnd(state, `${player.name}的城市已滿`);
      return;
    }
  }
}

import i18n from "../i18n";
import type { BuildingId, Good, Role, TileType } from "../engine/types";

export function roleName(role: Role): string {
  return i18n.t(`roles.${role}`, { ns: "terms" });
}

export function goodName(good: Good): string {
  return i18n.t(`goods.${good}`, { ns: "terms" });
}

export function tileName(tile: TileType): string {
  return i18n.t(`tiles.${tile}`, { ns: "terms" });
}

export function buildingName(id: BuildingId): string {
  return i18n.t(`buildings.${id}`, { ns: "terms" });
}

export function phasePrompt(type: string): string {
  const key = `phases.${type}`;
  const translated = i18n.t(key, { ns: "game" });
  return translated === key ? i18n.t("phases.default", { ns: "game" }) : translated;
}

export const GOOD_TONE: Record<Good | "quarry", string> = {
  corn: "#e2b83a",
  indigo: "#2a4580",
  sugar: "#f3efe4",
  tobacco: "#7a4a24",
  coffee: "#3c2418",
  quarry: "#8b8e93",
};

export function buildingTone(id: BuildingId): "prod" | "violet" | "large" {
  if (id === "guildHall" || id === "residence" || id === "fortress" || id === "customsHouse" || id === "cityHall") {
    return "large";
  }
  if (
    id === "smallIndigo" ||
    id === "smallSugar" ||
    id === "largeIndigo" ||
    id === "largeSugar" ||
    id === "tobaccoStorage" ||
    id === "coffeeRoaster"
  ) {
    return "prod";
  }
  return "violet";
}

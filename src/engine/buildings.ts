import raw from "../data/buildings.json";
import type { BuildingId, BuildingKind, Good } from "./types";

export interface BuildingDef {
  id: BuildingId;
  cost: number;
  vp: number;
  circles: number;
  citySpaces: number;
  quarryColumn: number;
  kind: BuildingKind;
  good?: Good;
  supply: number;
  nameZh: string;
  nameEn: string;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = raw as Record<BuildingId, BuildingDef>;

export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];

export function getBuilding(id: BuildingId): BuildingDef {
  return BUILDINGS[id];
}

export function emptyBuildingSupply(): Record<BuildingId, number> {
  const supply = {} as Record<BuildingId, number>;
  for (const id of BUILDING_IDS) {
    supply[id] = BUILDINGS[id].supply;
  }
  return supply;
}

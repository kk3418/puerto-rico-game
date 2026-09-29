import i18n from "../i18n";
import type { BuildingId, Role } from "../engine/types";

export function roleTip(role: Role): string {
  return i18n.t(`roleTips.${role}`, { ns: "terms" });
}

export function buildingTip(id: BuildingId): string {
  return i18n.t(`buildingTips.${id}`, { ns: "terms" });
}

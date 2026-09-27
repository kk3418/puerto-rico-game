import type { TFunction } from "i18next";
import type { LogEntry } from "../engine/types";

const ROLE_IDS = new Set(["settler", "mayor", "builder", "craftsman", "trader", "captain", "prospector"]);
const GOOD_IDS = new Set(["corn", "indigo", "sugar", "tobacco", "coffee"]);
const TILE_IDS = new Set([...GOOD_IDS, "quarry"]);

function translateId(t: TFunction, ns: string, id: string | number | undefined): string | undefined {
  if (id == null) return undefined;
  const key = String(id);
  const translated = t(`${ns}.${key}`, { ns: "terms" });
  return translated === `${ns}.${key}` ? key : translated;
}

export function formatLogEntry(entry: LogEntry, t: TFunction): string {
  if (!entry.key) return entry.text ?? "";
  const params = { ...entry.params };
  if (typeof params.role === "string" && ROLE_IDS.has(params.role)) {
    params.role = translateId(t, "roles", params.role) ?? params.role;
  }
  if (typeof params.building === "string") {
    params.building = translateId(t, "buildings", params.building) ?? params.building;
  }
  if (typeof params.good === "string" && GOOD_IDS.has(params.good)) {
    params.good = translateId(t, "goods", params.good) ?? params.good;
  }
  if (typeof params.tile === "string" && TILE_IDS.has(params.tile)) {
    params.tile = translateId(t, "plantations", params.tile) ?? params.tile;
  }
  if (typeof params.reasonKey === "string") {
    params.reason = t(`endReason.${params.reasonKey}`, { ns: "log", ...params });
  }
  return t(entry.key, { ns: "log", ...params });
}

export function formatEndReason(
  reason: string | null,
  t: TFunction,
  params?: Record<string, string | number>,
): string {
  if (!reason) return "";
  const known = ["vpExhausted", "colonistSupplyEmpty", "cityFull"];
  if (known.includes(reason)) {
    return t(`endReason.${reason}`, { ns: "log", ...params });
  }
  const cityMatch = reason.match(/^cityFull:(.+)$/);
  if (cityMatch) {
    return t("endReason.cityFull", { ns: "log", player: cityMatch[1] });
  }
  return reason;
}

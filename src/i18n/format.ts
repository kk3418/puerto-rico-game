import type { TFunction } from "i18next";
import i18n from "./index";
import type { LogEntry } from "../engine/types";

const ROLE_IDS = new Set(["settler", "mayor", "builder", "craftsman", "trader", "captain", "prospector"]);
const GOOD_IDS = new Set(["corn", "indigo", "sugar", "tobacco", "coffee"]);
const TILE_IDS = new Set([...GOOD_IDS, "quarry"]);

const LEGACY_END_REASONS: Record<string, string> = {
  "勝利分籌碼用盡": "vpExhausted",
  "殖民者供應耗盡，無法補滿殖民船": "colonistSupplyEmpty",
};

function translateId(t: TFunction, ns: string, id: string | number | undefined): string | undefined {
  if (id == null) return undefined;
  const key = String(id);
  const translated = t(`${ns}.${key}`, { ns: "terms" });
  return translated === `${ns}.${key}` ? key : translated;
}

function normalizeEndReasonKey(
  reason: string,
): { key: string; params?: Record<string, string | number> } | null {
  if (reason === "vpExhausted" || reason === "colonistSupplyEmpty" || reason === "cityFull") {
    return { key: reason };
  }
  const cityMatch = reason.match(/^cityFull:(.+)$/);
  if (cityMatch) {
    return { key: "cityFull", params: { player: cityMatch[1]! } };
  }
  const legacyKey = LEGACY_END_REASONS[reason];
  if (legacyKey) {
    return { key: legacyKey };
  }
  const legacyCity = reason.match(/^(.+)的城市已滿$/);
  if (legacyCity) {
    return { key: "cityFull", params: { player: legacyCity[1]! } };
  }
  return null;
}

export function formatLogEntry(entry: LogEntry, t: TFunction): string {
  if (!entry.key) return entry.text ?? "";
  const logKey = entry.key;
  if (!i18n.exists(logKey, { ns: "log" })) {
    return entry.text ?? logKey;
  }
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
  return t(logKey, { ns: "log", ...params });
}

export function formatEndReason(
  reason: string | null,
  t: TFunction,
  params?: Record<string, string | number>,
): string {
  if (!reason) return "";
  const normalized = normalizeEndReasonKey(reason);
  if (normalized) {
    return t(`endReason.${normalized.key}`, {
      ns: "log",
      ...params,
      ...normalized.params,
    });
  }
  return reason;
}

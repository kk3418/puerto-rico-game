import type { Action, Good, PlayerState } from "./types";
import { GOODS } from "./types";

export function assertSerializable(value: unknown): void {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Value is not JSON-serializable");
  const roundTrip = JSON.parse(json) as unknown;
  if (JSON.stringify(roundTrip) !== json) {
    throw new Error("JSON round-trip changed the value");
  }
}

export function cloneViaJson<T>(value: T): T {
  assertSerializable(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export const GOOD_PRICE: Record<Good, number> = {
  corn: 0,
  indigo: 1,
  sugar: 2,
  tobacco: 3,
  coffee: 4,
};

export function goodsList(player: PlayerState): Good[] {
  return GOODS.filter((g) => player.goods[g] > 0);
}

export function actionKey(action: Action): string {
  return JSON.stringify(action);
}

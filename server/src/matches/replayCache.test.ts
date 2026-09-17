import { describe, expect, it } from "vitest";
import { createInitialState } from "../../../src/engine";
import { createReplayCache } from "./replayCache";

function state(seed: number) {
  return createInitialState({
    playerCount: 3,
    difficulty: "balanced",
    seed,
    humanName: "你",
    governorIndex: 0,
  });
}

describe("replayCache", () => {
  it("returns a clone only when the event count matches", () => {
    const cache = createReplayCache();
    const stored = state(1);
    cache.write("m1", 4, stored);
    stored.round = 99;

    const hit = cache.read("m1", 4);
    expect(hit?.round).toBe(1);
    expect(cache.read("m1", 3)).toBeNull();
    expect(cache.read("m2", 4)).toBeNull();

    if (!hit) return;
    hit.round = 8;
    expect(cache.read("m1", 4)?.round).toBe(1);
  });

  it("evicts the least recently written match when full", () => {
    const cache = createReplayCache(2);
    cache.write("a", 1, state(1));
    cache.write("b", 1, state(2));
    cache.write("a", 2, state(1));
    cache.write("c", 1, state(3));
    expect(cache.read("b", 1)).toBeNull();
    expect(cache.read("a", 2)).not.toBeNull();
    expect(cache.read("c", 1)).not.toBeNull();
    expect(cache.size()).toBe(2);
  });
});

import { cloneState, type GameState } from "../../../src/engine";

export type ReplayCache = {
  read: (matchId: string, eventCount: number) => GameState | null;
  write: (matchId: string, eventCount: number, state: GameState) => void;
  drop: (matchId: string) => void;
  clear: () => void;
  size: () => number;
};

const DEFAULT_MAX_ENTRIES = 64;

export function createReplayCache(maxEntries = DEFAULT_MAX_ENTRIES): ReplayCache {
  const cache = new Map<string, { eventCount: number; state: GameState }>();

  return {
    read(matchId, eventCount) {
      const hit = cache.get(matchId);
      if (!hit || hit.eventCount !== eventCount) return null;
      return cloneState(hit.state);
    },
    write(matchId, eventCount, state) {
      if (cache.has(matchId)) cache.delete(matchId);
      cache.set(matchId, { eventCount, state: cloneState(state) });
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    },
    drop(matchId) {
      cache.delete(matchId);
    },
    clear() {
      cache.clear();
    },
    size() {
      return cache.size;
    },
  };
}

export const replayCache = createReplayCache();

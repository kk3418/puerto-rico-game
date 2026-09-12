import { useCallback, useRef, useState } from "react";
import { postMatchEvents } from "../api/matches";
import type { MatchEventInput } from "../api/types";
import type { Action, GameState } from "../engine";

export function useMatchSync(matchId: string, startSeq: number) {
  const seqRef = useRef(startSeq);
  const bufferRef = useRef<MatchEventInput[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setPending(0);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await postMatchEvents(matchId, batch);
        setSyncError(null);
        return;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    bufferRef.current = [...batch, ...bufferRef.current];
    setPending(bufferRef.current.length);
    const message = lastError instanceof Error ? lastError.message : "事件同步失敗";
    setSyncError(message);
    throw lastError instanceof Error ? lastError : new Error(message);
  }, [matchId]);

  const enqueue = useCallback(
    (before: GameState, action: Action, actorSeatIndex: number) => {
      bufferRef.current.push({
        seq: seqRef.current,
        round: before.round,
        phaseType: before.phase.type,
        activeRole: before.activeRole,
        actorSeatIndex,
        action,
      });
      seqRef.current += 1;
      setPending(bufferRef.current.length);
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush().catch(() => undefined);
      }, 250);
    },
    [flush],
  );

  return { enqueue, flush, pending, syncError };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { postMatchEvents } from "../api/matches";
import type { MatchEventInput } from "../api/types";
import type { Action, GameState } from "../engine";
import { createMatchSyncQueue, type MatchSyncQueue } from "./matchSyncQueue";

export function useMatchSync(matchId: string, startSeq: number, playToken: string) {
  const seqRef = useRef(startSeq);
  const matchIdRef = useRef(matchId);
  matchIdRef.current = matchId;
  const playTokenRef = useRef(playToken);
  playTokenRef.current = playToken;
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const queueRef = useRef<MatchSyncQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = createMatchSyncQueue({
      post: (events, init) =>
        postMatchEvents(matchIdRef.current, events, playTokenRef.current, init).then(() => undefined),
      onPending: setPending,
      onError: (message) => {
        setSyncError(message);
        if (message) console.error(message);
      },
    });
  }

  useEffect(() => {
    const onPageHide = () => {
      void queueRef.current?.flush({ keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      // Do not drop the queue on unmount. React StrictMode runs this cleanup on the
      // first mount; flushing preserves buffered events so a refresh can restore them.
      void queueRef.current?.flush().catch(() => undefined);
    };
  }, []);

  const flush = useCallback((init?: { keepalive?: boolean }) => queueRef.current!.flush(init), []);

  const enqueue = useCallback((before: GameState, action: Action, actorSeatIndex: number) => {
    const event: MatchEventInput = {
      seq: seqRef.current,
      round: before.round,
      phaseType: before.phase.type,
      activeRole: before.activeRole,
      actorSeatIndex,
      action,
    };
    seqRef.current += 1;
    queueRef.current!.enqueue(event);
  }, []);

  return { enqueue, flush, pending, syncError };
}

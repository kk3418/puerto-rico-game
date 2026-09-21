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
      post: (events) => postMatchEvents(matchIdRef.current, events, playTokenRef.current).then(() => undefined),
      onPending: setPending,
      onError: (message) => {
        setSyncError(message);
        if (message) console.error(message);
      },
    });
  }

  useEffect(() => {
    return () => queueRef.current?.abort();
  }, []);

  const flush = useCallback(() => queueRef.current!.flush(), []);

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

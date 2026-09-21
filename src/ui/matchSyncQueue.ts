import { ApiError } from "../api/client";
import type { MatchEventInput } from "../api/types";

export type MatchSyncQueue = {
  enqueue: (event: MatchEventInput) => void;
  flush: () => Promise<void>;
  abort: () => void;
};

function isRetriableSyncError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return true;
}

function toError(err: unknown, fallback: string): Error {
  return err instanceof Error ? err : new Error(fallback);
}

export function createMatchSyncQueue(options: {
  post: (events: MatchEventInput[]) => Promise<void>;
  debounceMs?: number;
  maxAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule?: (id: ReturnType<typeof setTimeout>) => void;
  sleep?: (ms: number) => Promise<void>;
  onPending?: (count: number) => void;
  onError?: (message: string | null) => void;
}): MatchSyncQueue {
  const debounceMs = options.debounceMs ?? 250;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelay = options.retryDelayMs ?? ((attempt) => 350 * (attempt + 1));
  const schedule = options.schedule ?? setTimeout;
  const unschedule = options.unschedule ?? clearTimeout;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let buffer: MatchEventInput[] = [];
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  let fatalError: Error | null = null;
  let aborted = false;
  let resumeSleep: (() => void) | undefined;

  function notify() {
    options.onPending?.(buffer.length + inFlight);
  }

  function clearDebounce() {
    if (timer !== undefined) {
      unschedule(timer);
      timer = undefined;
    }
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      resumeSleep = resolve;
      void sleep(ms).then(() => {
        if (resumeSleep === resolve) resumeSleep = undefined;
        resolve();
      });
    });
  }

  function stopSleep() {
    resumeSleep?.();
    resumeSleep = undefined;
  }

  function settleAbort(): void {
    buffer = [];
    inFlight = 0;
    notify();
  }

  function latchFatal(err: unknown): Error {
    const error = toError(err, "事件同步失敗");
    fatalError = error;
    buffer = [];
    inFlight = 0;
    clearDebounce();
    notify();
    options.onError?.(error.message);
    return error;
  }

  async function sendLoop() {
    if (aborted) return;
    if (fatalError) throw fatalError;
    clearDebounce();
    while (buffer.length > 0) {
      if (aborted) {
        settleAbort();
        return;
      }
      if (fatalError) throw fatalError;
      const batch = buffer;
      buffer = [];
      inFlight = batch.length;
      notify();
      let lastError: unknown;
      let sent = false;
      const attempts = Math.max(1, maxAttempts);
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (aborted) {
          settleAbort();
          return;
        }
        try {
          await options.post(batch);
          if (aborted) {
            settleAbort();
            return;
          }
          sent = true;
          options.onError?.(null);
          break;
        } catch (err) {
          if (aborted) {
            settleAbort();
            return;
          }
          lastError = err;
          if (!isRetriableSyncError(err) || attempt >= attempts - 1) break;
          await wait(retryDelay(attempt));
        }
      }
      inFlight = 0;
      if (aborted) {
        settleAbort();
        return;
      }
      if (!sent) {
        if (isRetriableSyncError(lastError)) {
          buffer = [...batch, ...buffer];
          notify();
          const error = toError(lastError, "事件同步失敗");
          options.onError?.(error.message);
          throw error;
        }
        throw latchFatal(lastError);
      }
      notify();
    }
  }

  function flush() {
    if (aborted) return Promise.resolve();
    if (fatalError) return Promise.reject(fatalError);
    const next = chain.then(sendLoop, sendLoop);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function enqueue(event: MatchEventInput) {
    if (aborted || fatalError) return;
    buffer.push(event);
    notify();
    clearDebounce();
    timer = schedule(() => {
      timer = undefined;
      void flush().catch(() => undefined);
    }, debounceMs);
  }

  function abort() {
    aborted = true;
    clearDebounce();
    stopSleep();
    settleAbort();
  }

  return { enqueue, flush, abort };
}

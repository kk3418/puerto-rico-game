import { ApiError } from "../api/client";
import type { MatchEventInput } from "../api/types";

export type MatchSyncQueue = {
  enqueue: (event: MatchEventInput) => void;
  flush: () => Promise<void>;
};

export function isRetriableSyncError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 429;
  }
  return true;
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
  let fatal: Error | null = null;

  function notify() {
    options.onPending?.(buffer.length + inFlight);
  }

  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : "事件同步失敗";
  }

  function markFatal(err: unknown): Error {
    const next = err instanceof Error ? err : new Error(errorMessage(err));
    fatal = next;
    buffer = [];
    inFlight = 0;
    clearDebounce();
    notify();
    options.onError?.(next.message);
    return next;
  }

  function clearDebounce() {
    if (timer !== undefined) {
      unschedule(timer);
      timer = undefined;
    }
  }

  async function sendLoop() {
    if (fatal) throw fatal;
    clearDebounce();
    while (buffer.length > 0) {
      const batch = buffer;
      buffer = [];
      inFlight = batch.length;
      notify();
      let lastError: unknown;
      let sent = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          await options.post(batch);
          sent = true;
          options.onError?.(null);
          break;
        } catch (err) {
          lastError = err;
          if (!isRetriableSyncError(err)) {
            throw markFatal(err);
          }
          if (attempt < maxAttempts - 1) {
            await sleep(retryDelay(attempt));
          }
        }
      }
      inFlight = 0;
      if (!sent) {
        buffer = [...batch, ...buffer];
        notify();
        const message = errorMessage(lastError);
        options.onError?.(message);
        throw lastError instanceof Error ? lastError : new Error(message);
      }
      notify();
    }
  }

  function flush() {
    const next = chain.then(sendLoop, sendLoop);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function enqueue(event: MatchEventInput) {
    if (fatal) {
      options.onError?.(fatal.message);
      return;
    }
    buffer.push(event);
    notify();
    clearDebounce();
    timer = schedule(() => {
      timer = undefined;
      void flush().catch(() => undefined);
    }, debounceMs);
  }

  return { enqueue, flush };
}

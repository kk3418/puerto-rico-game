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

  function notify() {
    options.onPending?.(buffer.length + inFlight);
  }

  function clearDebounce() {
    if (timer !== undefined) {
      unschedule(timer);
      timer = undefined;
    }
  }

  async function sendLoop() {
    clearDebounce();
    while (buffer.length > 0) {
      const batch = buffer;
      buffer = [];
      inFlight = batch.length;
      notify();
      let lastError: unknown;
      let sent = false;
      const attempts = Math.max(1, maxAttempts);
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await options.post(batch);
          sent = true;
          options.onError?.(null);
          break;
        } catch (err) {
          lastError = err;
          if (!isRetriableSyncError(err) || attempt >= attempts - 1) break;
          await sleep(retryDelay(attempt));
        }
      }
      inFlight = 0;
      if (!sent) {
        const retriable = isRetriableSyncError(lastError);
        if (retriable) buffer = [...batch, ...buffer];
        notify();
        const message = lastError instanceof Error ? lastError.message : "事件同步失敗";
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
    buffer.push(event);
    notify();
    clearDebounce();
    timer = schedule(() => {
      timer = undefined;
      void flush().catch(() => undefined);
    }, debounceMs);
  }

  function abort() {
    clearDebounce();
    buffer = [];
    inFlight = 0;
    notify();
  }

  return { enqueue, flush, abort };
}

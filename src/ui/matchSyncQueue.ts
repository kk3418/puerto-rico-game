import type { MatchEventInput } from "../api/types";

export type MatchSyncQueue = {
  enqueue: (event: MatchEventInput) => void;
  flush: () => Promise<void>;
};

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
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          await options.post(batch);
          sent = true;
          options.onError?.(null);
          break;
        } catch (err) {
          lastError = err;
          if (attempt < maxAttempts - 1) {
            await sleep(retryDelay(attempt));
          }
        }
      }
      inFlight = 0;
      if (!sent) {
        buffer = [...batch, ...buffer];
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

  return { enqueue, flush };
}

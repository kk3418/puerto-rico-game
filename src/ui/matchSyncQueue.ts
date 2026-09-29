import { ApiError } from "../api/client";
import type { MatchEventInput } from "../api/types";
import { formatApiError } from "../api/errorMessage";
import i18n from "../i18n";

export type MatchSyncPostInit = { keepalive?: boolean };

export type MatchSyncQueue = {
  enqueue: (event: MatchEventInput) => void;
  flush: (init?: MatchSyncPostInit) => Promise<void>;
};

function isRetriableSyncError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return true;
}

function toError(err: unknown, fallback: string): Error {
  if (err instanceof Error) {
    return new Error(formatApiError(err, fallback));
  }
  return new Error(fallback);
}

export function createMatchSyncQueue(options: {
  post: (events: MatchEventInput[], init?: MatchSyncPostInit) => Promise<void>;
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
  let inFlightBatch: MatchEventInput[] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<void> = Promise.resolve();
  let queuedFlushes = 0;
  let fatalError: Error | null = null;

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
      void sleep(ms).then(resolve);
    });
  }

  function latchFatal(err: unknown): Error {
    const error = toError(err, i18n.t("eventSyncFailed"));
    fatalError = error;
    buffer = [];
    inFlight = 0;
    inFlightBatch = null;
    clearDebounce();
    notify();
    options.onError?.(error.message);
    return error;
  }

  async function sendLoop(init?: MatchSyncPostInit) {
    if (fatalError) throw fatalError;
    clearDebounce();
    while (buffer.length > 0) {
      if (fatalError) throw fatalError;
      const batch = buffer;
      buffer = [];
      inFlightBatch = batch;
      inFlight = batch.length;
      notify();
      let lastError: unknown;
      let sent = false;
      const attempts = Math.max(1, maxAttempts);
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await options.post(batch, init);
          sent = true;
          options.onError?.(null);
          break;
        } catch (err) {
          lastError = err;
          if (!isRetriableSyncError(err) || attempt >= attempts - 1) break;
          await wait(retryDelay(attempt));
        }
      }
      if (inFlightBatch === batch) {
        inFlightBatch = null;
      }
      inFlight = 0;
      if (!sent) {
        if (isRetriableSyncError(lastError)) {
          buffer = [...batch, ...buffer];
          notify();
          const error = toError(lastError, i18n.t("eventSyncFailed"));
          options.onError?.(error.message);
          throw error;
        }
        throw latchFatal(lastError);
      }
      notify();
    }
  }

  function flushKeepalive(): Promise<void> {
    clearDebounce();
    const batch = [...(inFlightBatch ?? []), ...buffer];
    buffer = [];
    notify();
    if (batch.length === 0) return Promise.resolve();
    // Start the keepalive fetch in this turn. Do not wait for a non-keepalive in-flight
    // post that the browser may abort on unload; duplicate seqs are idempotent on the server.
    const job = options.post(batch, { keepalive: true }).then(() => {
      options.onError?.(null);
    });
    queuedFlushes += 1;
    const settled = job.finally(() => {
      queuedFlushes -= 1;
    });
    tail = Promise.all([tail, settled]).then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  function flush(init?: MatchSyncPostInit) {
    if (fatalError) return Promise.reject(fatalError);
    if (init?.keepalive) return flushKeepalive();

    queuedFlushes += 1;
    // Run immediately when idle so pagehide can start a keepalive fetch in the same turn.
    const job = queuedFlushes === 1 ? sendLoop(init) : tail.then(() => sendLoop(init), () => sendLoop(init));
    const settled = job.finally(() => {
      queuedFlushes -= 1;
    });
    tail = settled.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  function enqueue(event: MatchEventInput) {
    if (fatalError) return;
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

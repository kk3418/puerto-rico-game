import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { MatchEventInput } from "../api/types";
import { createMatchSyncQueue } from "./matchSyncQueue";

function event(seq: number): MatchEventInput {
  return {
    seq,
    round: 1,
    actorSeatIndex: 0,
    action: { type: "mayorDone" },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createMatchSyncQueue", () => {
  it("serializes overlapping flushes and includes events enqueued during an in-flight post", async () => {
    const started: number[][] = [];
    const inflight = { count: 0, max: 0 };
    const first = deferred<void>();
    let posts = 0;
    const queue = createMatchSyncQueue({
      debounceMs: 10_000,
      async post(events) {
        posts += 1;
        inflight.count += 1;
        inflight.max = Math.max(inflight.max, inflight.count);
        started.push(events.map((item) => item.seq));
        if (posts === 1) await first.promise;
        inflight.count -= 1;
      },
    });

    queue.enqueue(event(1));
    const firstFlush = queue.flush();
    await Promise.resolve();
    queue.enqueue(event(2));
    const secondFlush = queue.flush();
    first.resolve();
    await Promise.all([firstFlush, secondFlush]);

    expect(inflight.max).toBe(1);
    expect(started).toEqual([[1], [2]]);
  });

  it("starts the post during flush so a refresh can send the buffered batch", () => {
    let started = false;
    const queue = createMatchSyncQueue({
      debounceMs: 10_000,
      async post() {
        started = true;
      },
    });
    queue.enqueue(event(1));
    void queue.flush();
    expect(started).toBe(true);
  });

  it("passes keepalive only when flush requests it", async () => {
    const flags: Array<boolean | undefined> = [];
    const queue = createMatchSyncQueue({
      debounceMs: 10_000,
      async post(_events, init) {
        flags.push(init?.keepalive);
      },
    });
    queue.enqueue(event(1));
    await queue.flush();
    queue.enqueue(event(2));
    await queue.flush({ keepalive: true });
    expect(flags).toEqual([undefined, true]);
  });

  it("keepalive flush re-posts the in-flight batch without waiting for the non-keepalive post", async () => {
    const gate = deferred<void>();
    const posts: Array<{ seqs: number[]; keepalive?: boolean }> = [];
    const queue = createMatchSyncQueue({
      debounceMs: 10_000,
      async post(events, init) {
        posts.push({ seqs: events.map((item) => item.seq), keepalive: init?.keepalive });
        if (!init?.keepalive) await gate.promise;
      },
    });
    queue.enqueue(event(1));
    const regular = queue.flush();
    await Promise.resolve();
    expect(posts).toEqual([{ seqs: [1], keepalive: undefined }]);

    queue.enqueue(event(2));
    const keepalive = queue.flush({ keepalive: true });
    expect(posts).toEqual([
      { seqs: [1], keepalive: undefined },
      { seqs: [1, 2], keepalive: true },
    ]);

    gate.resolve();
    await Promise.all([regular, keepalive]);
  });

  it("does not return from flush until the in-flight batch has been posted", async () => {
    const gate = deferred<void>();
    let finished = false;
    const queue = createMatchSyncQueue({
      debounceMs: 10_000,
      async post() {
        await gate.promise;
      },
    });
    queue.enqueue(event(1));
    const flushing = queue.flush().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    gate.resolve();
    await flushing;
    expect(finished).toBe(true);
  });

  it("requeues a failed batch so a later flush retries it", async () => {
    let attempts = 0;
    const received: number[][] = [];
    const queue = createMatchSyncQueue({
      debounceMs: 10_000,
      maxAttempts: 1,
      async post(events) {
        attempts += 1;
        received.push(events.map((item) => item.seq));
        if (attempts === 1) throw new Error("network");
      },
    });
    queue.enqueue(event(3));
    await expect(queue.flush()).rejects.toThrow("network");
    await queue.flush();
    expect(received).toEqual([[3], [3]]);
  });

  it("latches 4xx illegal-action errors so flush stays failed and later events are not posted", async () => {
    let attempts = 0;
    const received: number[][] = [];
    const errors: Array<string | null> = [];
    const queue = createMatchSyncQueue({
      debounceMs: 10_000,
      maxAttempts: 3,
      onError: (message) => errors.push(message),
      async post(events) {
        attempts += 1;
        received.push(events.map((item) => item.seq));
        throw new ApiError(400, "事件 6 無法套用：ILLEGAL_ACTION", "EVENT_APPLY_FAILED", {
          seq: 6,
          detail: "ILLEGAL_ACTION",
        });
      },
    });
    queue.enqueue(event(6));
    await expect(queue.flush()).rejects.toThrow(/illegal action|非法行動/);
    queue.enqueue(event(7));
    await expect(queue.flush()).rejects.toThrow(/illegal action|非法行動/);
    expect(attempts).toBe(1);
    expect(received).toEqual([[6]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/illegal action|非法行動/);
  });
});

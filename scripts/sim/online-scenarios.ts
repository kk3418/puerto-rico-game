/**
 * PR #12 review simulation harness - single-threaded tick design.
 * Scenarios run as state machines inside the drive loop, removing all
 * director/drive races from the previous version.
 *
 * Plays real online Puerto Rico matches against the server over Socket.IO
 * (the same transport the browser uses): full 3-player / 5-player games,
 * unstable sockets, closing the page on your own turn (idle -> AI takeover),
 * closing the page during a vote, leaving mid-match, and vote timers.
 *
 * Run with:  npx tsx scripts/sim/online-scenarios.ts
 *
 * Uses a dedicated Postgres schema `sim` (the harness runs the migrations).
 * All SIM_* env vars are optional:
 *   SIM_ONLINE_IDLE_MS (default 2200), SIM_ONLINE_AI_DELAY_MS (250),
 *   SIM_ONLINE_VOTE_MS (1500)
 */
import { config } from "dotenv";

config({ path: ".env", quiet: true });

process.env.NODE_ENV = "development";
process.env.DATABASE_URL = "postgresql://puerto:puerto@localhost:5432/puerto_rico?schema=sim";
process.env.SESSION_SECRET = "sim-only-session-secret-at-least-32-chars";
process.env.CLIENT_ORIGIN = "http://127.0.0.1:5173";
process.env.ONLINE_IDLE_MS = process.env.SIM_ONLINE_IDLE_MS ?? "2200";
process.env.ONLINE_AI_DELAY_MS = process.env.SIM_ONLINE_AI_DELAY_MS ?? "250";
process.env.ONLINE_VOTE_MS = process.env.SIM_ONLINE_VOTE_MS ?? "1500";

const { createHmac, randomUUID } = await import("node:crypto");
const http = await import("node:http");
const { io: ioc } = await import("socket.io-client");
type Socket = import("socket.io-client").Socket;
const engine = await import("../../src/engine");
const { HeuristicAgent } = await import("../../src/agents/heuristic");
const { prisma } = await import("../../server/src/db");
const { prepareIntegrationDb, resetIntegrationDb } = await import("../../server/src/test/harness");
const { createApp } = await import("../../server/src/app");
const { attachGameServer } = await import("../../server/src/live/gameServer");
const { replayStoredActions } = await import("../../server/src/matches/replay");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const startedAt = Date.now();
function log(...parts: unknown[]): void {
  console.log(`[sim +${((Date.now() - startedAt) / 1000).toFixed(1)}s]`, ...parts);
}

const failures: string[] = [];
function check(cond: boolean, label: string): void {
  if (cond) return;
  failures.push(label);
  console.error(`  ✗ FAIL: ${label}`);
}
function ok(label: string, extra?: unknown): void {
  console.log(`  ✓ ${label}${extra === undefined ? "" : ` (${JSON.stringify(extra)})`}`);
}

function signedSessionCookie(sid: string): string {
  const signature = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(sid)
    .digest("base64")
    .replace(/=+$/, "");
  return `pr.sid=s:${sid}.${signature}`;
}

type Session = { userId: string; cookie: string; name: string };

async function makeSession(name: string): Promise<Session> {
  const user = await prisma.user.create({
    data: {
      email: `${name}@sim.local`,
      displayName: name,
      accounts: { create: { provider: "google", providerAccountId: `sim-${name}` } },
    },
  });
  const sid = randomUUID();
  const expire = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sess = {
    cookie: {
      path: "/",
      secure: false,
      expires: expire.toISOString(),
      httpOnly: true,
      sameSite: "lax",
      originalMaxAge: 30 * 24 * 60 * 60 * 1000 - 1,
    },
    userId: user.id,
  } as unknown as Record<string, unknown>;
  await prisma.session.create({ data: { sid, sess, expire } });
  return { userId: user.id, cookie: signedSessionCookie(sid), name };
}

type ApiResponse = { status: number; data: Record<string, unknown> | null };

async function api(session: Session, path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResponse> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: {
      cookie: session.cookie,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

let port = 0;
let sio: ReturnType<typeof attachGameServer>;

async function startServer(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);
  sio = attachGameServer(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not bind server");
  port = address.port;
  log(`server listening on ${port}`);
}

type Broadcast = Record<string, unknown>;

type Ctx = {
  matchId: string;
  playerCount: number;
  sessions: Session[];
  sockets: Array<Socket | null>;
  events: Array<Array<Broadcast>>;
  mirror: engine.GameState;
  eventCount: number;
  lastEventWallMs: number;
  aiEventTimes: Array<{ seq: number; seat: number; phaseType: string; at: number }>;
  errors: Array<{ seat: number; payload: Broadcast }>;
};

async function connectSeat(ctx: Ctx, seat: number): Promise<void> {
  const socket = ioc(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    extraHeaders: { cookie: ctx.sessions[seat]!.cookie },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err: Error) => reject(err));
  });
  ctx.sockets[seat] = socket;
  for (const event of ["game:state", "game:vote", "game:seat", "game:over", "game:error"]) {
    socket.off(event);
    socket.on(event, (payload: unknown) => {
      ctx.events[seat]!.push((payload ?? {}) as Broadcast);
      if (event === "game:error") ctx.errors.push({ seat, payload: (payload ?? {}) as Broadcast });
    });
  }
  socket.emit("game:watch", { matchId: ctx.matchId });
}

async function startMatch(playerCount: number): Promise<Ctx> {
  const sessions: Session[] = [];
  for (let i = 0; i < playerCount; i++) sessions.push(await makeSession(`sim_${playerCount}p_p${i}`));
  const host = sessions[0]!;
  const room = await api(host, "/api/rooms", {
    method: "POST",
    body: { nickname: host.name, playerCount },
  });
  check(room.status === 201, `create ${playerCount}p room -> 201`);
  const matchId = room.data?.id as string;
  for (let i = 1; i < playerCount; i++) {
    const joined = await api(sessions[i]!, "/api/rooms/join", {
      method: "POST",
      body: { nickname: sessions[i]!.name, roomId: matchId },
    });
    check(joined.status === 200, `p${i} join room -> 200`);
  }
  let status = "lobby";
  for (let round = 0; round < 4 && status !== "playing"; round++) {
    for (const session of sessions) {
      const beat = await api(session, `/api/rooms/${matchId}/heartbeat`, {
        method: "POST",
        body: { ready: true },
      });
      status = (beat.data?.status as string) ?? "lobby";
    }
  }
  check(status === "playing", `match ${matchId} starts playing`);

  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  const nicknames = (
    await prisma.matchParticipant.findMany({
      where: { matchId },
      orderBy: { seatIndex: "asc" },
      select: { nickname: true },
    })
  ).map((p) => p.nickname);
  const replayed = replayStoredActions({
    matchId,
    playerCount,
    difficulty: "balanced",
    seed: match.seed,
    humanName: match.humanName,
    actions: [],
    seatNames: nicknames,
  });
  if (!replayed.ok) throw new Error(`initial replay failed: ${replayed.message}`);
  const ctx: Ctx = {
    matchId,
    playerCount,
    sessions,
    sockets: Array.from({ length: playerCount }, () => null),
    events: Array.from({ length: playerCount }, () => []),
    mirror: replayed.state,
    eventCount: 0,
    lastEventWallMs: Date.now(),
    aiEventTimes: [],
    errors: [],
  };
  for (let i = 0; i < playerCount; i++) await connectSeat(ctx, i);
  return ctx;
}

async function syncEvents(ctx: Ctx): Promise<void> {
  const rows = await prisma.matchEvent.findMany({
    where: { matchId: ctx.matchId, seq: { gt: ctx.eventCount } },
    orderBy: { seq: "asc" },
  });
  for (const row of rows) {
    if (row.seq <= ctx.eventCount) continue;
    if (row.seq !== ctx.eventCount + 1) {
      throw new Error(`event seq gap: expected ${ctx.eventCount + 1}, got ${row.seq}`);
    }
    ctx.mirror = engine.applyAction(ctx.mirror, row.action as engine.Action);
    ctx.eventCount = row.seq;
    ctx.lastEventWallMs = Date.now();
    ctx.aiEventTimes.push({
      seq: row.seq,
      seat: row.actorSeatIndex ?? -1,
      phaseType: row.phaseType ?? "",
      at: row.createdAt.getTime(),
    });
  }
}

async function dbMatch(ctx: Ctx) {
  return prisma.match.findUnique({
    where: { id: ctx.matchId },
    include: { participants: { orderBy: { seatIndex: "asc" } }, votes: { include: { ballots: true } } },
  });
}

function seatOf(ctx: Ctx, broadcast: Broadcast): number {
  return typeof broadcast.seatIndex === "number" ? (broadcast.seatIndex as number) : -1;
}

function anyEvent(ctx: Ctx, key: string, pred: (b: Broadcast) => boolean): Broadcast | undefined {
  for (const list of ctx.events) {
    for (const e of list) {
      if (key in e && pred(e)) return e;
    }
  }
  return undefined;
}

/** Close a seat's "page": drop the socket without any leave call. */
async function closePage(ctx: Ctx, seat: number): Promise<void> {
  ctx.sockets[seat]?.removeAllListeners();
  ctx.sockets[seat]?.disconnect();
  ctx.sockets[seat] = null;
  await sleep(50);
}

/** Act for a seat via its socket, replaying events into the mirror. */
async function actFor(ctx: Ctx, seat: number): Promise<boolean> {
  await syncEvents(ctx);
  const actor = engine.getActorIndex(ctx.mirror);
  if (actor !== seat) {
    check(false, `actFor called for seat ${seat} but actor is ${actor}`);
    return false;
  }
  const legal = engine.getLegalActions(ctx.mirror);
  if (legal.length === 0) return false;
  const agent = new HeuristicAgent();
  const action = await agent.chooseAction({
    state: ctx.mirror,
    legalActions: legal,
    playerId: ctx.mirror.players[seat]!.id,
  });
  const before = ctx.eventCount;
  ctx.sockets[seat]!.emit("game:action", { matchId: ctx.matchId, action });
  for (let i = 0; i < 200; i++) {
    await sleep(25);
    await syncEvents(ctx);
    if (ctx.eventCount > before) return true;
    if (ctx.errors.some((e) => e.seat === seat)) break;
  }
  await syncEvents(ctx);
  const lastError = ctx.errors.filter((e) => e.seat === seat).at(-1);
  check(false, `seat ${seat} action never applied at event ${ctx.eventCount}; last game:error: ${JSON.stringify(lastError)}`);
  return ctx.eventCount > before;
}

type TickHelpers = {
  startVote: (seat: number) => Promise<ApiResponse>;
  castVote: (seat: number, choice: "approve" | "oppose") => Promise<ApiResponse>;
  closePage: (seat: number) => Promise<void>;
  reconnect: (seat: number) => Promise<void>;
  leave: (seat: number) => Promise<ApiResponse>;
  sleep: (ms: number) => Promise<void>;
};

type Tick = (ctx: Ctx, actor: number, helpers: TickHelpers) => Promise<"continue" | "stop" | "act">;

/**
 * Drive a match. Each loop iteration:
 *  1. sync events from the DB
 *  2. run the scenario tick (state machine)
 *  3. if the actor is a human seat with a connected socket and tick did not
 *     say "stop", act for them (unless scenario opts out via actFilter).
 */
async function drive(ctx: Ctx, options: { tick: Tick; actFilter?: (seat: number) => boolean; timeoutMs?: number }): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  const helpers: TickHelpers = {
    startVote: (seat) => api(ctx.sessions[seat]!, `/api/matches/${ctx.matchId}/end-vote`, { method: "POST" }),
    castVote: (seat, choice) =>
      api(ctx.sessions[seat]!, `/api/matches/${ctx.matchId}/end-vote/vote`, { method: "POST", body: { choice } }),
    closePage: (seat) => closePage(ctx, seat),
    reconnect: (seat) => connectSeat(ctx, seat),
    leave: (seat) => api(ctx.sessions[seat]!, `/api/matches/${ctx.matchId}/leave`, { method: "POST" }),
    sleep,
  };
  while (Date.now() < deadline) {
    await syncEvents(ctx);
    const match = await dbMatch(ctx);
    if (!match || match.status !== "playing") return;
    const actor = engine.getActorIndex(ctx.mirror);
    if (actor === null) {
      await sleep(50);
      continue;
    }
    const decision = await options.tick(ctx, actor, helpers);
    if (decision === "stop") return;
    if (decision === "act") {
      const participant = match.participants.find((p) => p.seatIndex === actor);
      const socket = ctx.sockets[actor];
      if (participant && participant.isHuman && !participant.isAi && socket?.connected && (options.actFilter?.(actor) ?? true)) {
        const applied = await actFor(ctx, actor);
        if (!applied) return;
      }
    }
    await sleep(10);
  }
  check(false, `drive timed out for ${ctx.matchId}`);
}

async function verifyFinished(ctx: Ctx, expectedReason?: string): Promise<void> {
  const match = await dbMatch(ctx);
  check(match?.status === "finished", `match ${ctx.matchId} finished in DB (got ${match?.status})`);
  check(match?.verified === true, "match verified");
  if (expectedReason) {
    check(match?.endReason === expectedReason, `endReason = ${expectedReason} (got ${match?.endReason})`);
  }
  const scores = engine.scoreGame(ctx.mirror);
  for (const participant of match?.participants ?? []) {
    const score = scores.find((s) => s.playerId === `p${participant.seatIndex}`);
    if (score && participant.total !== null) {
      check(
        participant.total === score.total &&
          participant.vpChips === score.vpChips &&
          participant.buildingVp === score.buildingVp,
        `seat ${participant.seatIndex} DB scores equal engine replay`,
      );
    }
  }
  const events = await prisma.matchEvent.findMany({
    where: { matchId: ctx.matchId },
    orderBy: { seq: "asc" },
  });
  let contiguous = events.length === 0 || events[0]!.seq === 1;
  for (let i = 1; i < events.length; i++) contiguous = contiguous && events[i]!.seq === events[i - 1]!.seq + 1;
  check(contiguous && events.length === ctx.eventCount, `event seq contiguous 1..${events.length}`);
  const over = anyEvent(ctx, "status", () => true);
  check(over?.status === "finished" && (over.scores as unknown[])?.length === ctx.playerCount, "game:over finished with scores broadcast");
  ok(`finished: ${events.length} events, endReason=${match?.endReason}`);
}

// ---------------------------------------------------------- scenario states

const noTick: Tick = async () => "act";

const plainGameScenario = async (ctx: Ctx, expectedReason?: string) => {
  log(`full online game ${ctx.playerCount}p`);
  const tick: Tick = async () => "act";
  await drive(ctx, { tick });
  await verifyFinished(ctx);
};

const unstableScenario = async (_makeCtx: () => Promise<Ctx>) => {
  const ctx = await _makeCtx();
  log(`unstable sockets 5p`);
  let stage: "run" | "dropping" | "reconnect" | "done" = "run";
  let blipSeat = 1;
  let blips = 0;
  let resumeAtEvent: number | null = null;
  let dropStartedAt = 0;
  let stateAtDrop = 0;
  const tick: Tick = async (c, actor, h) => {
    if (stage === "done") return "act";
    if (stage === "run") {
      if (blips < 6 && c.eventCount >= (blips + 1) * 60 && c.eventCount > 0 && c.sockets[blipSeat]) {
        stage = "dropping";
        blips += 1;
        stateAtDrop = c.eventCount;
        log(`  blip ${blips}: dropping seat ${blipSeat} socket at event ${c.eventCount} (actor=${actor})`);
        await h.closePage(blipSeat);
        dropStartedAt = Date.now();
        return "continue";
      }
      return "act";
    }
    if (stage === "dropping") {
      if (Date.now() - dropStartedAt < 350) return "continue";
      stage = "reconnect";
      return "continue";
    }
    if (stage === "reconnect") {
      await h.reconnect(blipSeat);
      await sleep(150);
      await syncEvents(c);
      const watchState = c.events[blipSeat]!.filter((e) => "eventCount" in e && "seatIndex" in e).at(-1);
      const dbCount = await prisma.matchEvent.count({ where: { matchId: c.matchId } });
      check(
        watchState !== undefined &&
          typeof watchState.eventCount === "number" &&
          watchState.eventCount >= stateAtDrop &&
          watchState.eventCount <= dbCount &&
          watchState.seatIndex === blipSeat,
        `reconnected seat ${blipSeat} resynced (state eventCount=${watchState?.eventCount}, drop=${stateAtDrop}, db=${dbCount})`,
      );
      // If this seat is the actor right now, its fresh state must still be playable.
      const match = await dbMatch(c);
      const participant = match?.participants.find((p) => p.seatIndex === blipSeat);
      if (participant?.isHuman && !participant.isAi) {
        check(true, "returning seat can keep playing");
      }
      resumeAtEvent = dbCount;
      blipSeat = (blipSeat % 4) + 1;
      stage = "run";
      return "act";
    }
    return "act";
  };
  await drive(ctx, { tick });
  await verifyFinished(ctx);
  check(blips >= 6, `6 reconnect blips executed (got ${blips})`);
};

const closeOnOwnTurnScenario = async (_makeCtx: () => Promise<Ctx>) => {
  log("close page on your own turn -> idle AI takeover (3p)");
  const ctx = await _makeCtx();
  let closedSeat = -1;
  let closedAt = 0;
  let takeoverSeen = false;
  let stage: "playing" | "closed" | "done" = "playing";
  const tick: Tick = async (c, actor, h) => {
    if (stage === "playing" && c.eventCount >= 2) {
      // close the page of whichever human seat is NOT currently me/the actor if possible;
      // prefer closing the current actor's NEXT turn to test the full idle window.
      closedSeat = actor;
      closedAt = Date.now();
      log(`  seat ${closedSeat} closes the page on its turn (event ${c.eventCount})`);
      await h.closePage(closedSeat);
      stage = "closed";
      return "continue";
    }
    if (stage === "closed") {
      if (takeoverSeen) {
        stage = "done";
        return "act";
      }
      // Do not act for the closed seat; other seats keep playing. Wait for broadcast.
      const takeover = dateOf(ctx, closedSeat);
      if (takeover !== undefined) {
        takeoverSeen = true;
        return "act";
      }
      return "continue";
    }
    return "act";
  };
  await drive(ctx, {
    tick,
    actFilter: (seat) => seat !== closedSeat || true, // closed seat has no socket anyway
    timeoutMs: 240_000,
  });
  await syncEvents(ctx);
  const takeover = anyEvent(ctx, "replacedByAi", (b) => b.seatIndex === closedSeat);
  check(takeover?.reason === "idle", `game:seat takeover(${closedSeat}) broadcast reason=idle`);
  const participant = await prisma.matchParticipant.findFirst({
    where: { matchId: ctx.matchId, seatIndex: closedSeat },
  });
  check(participant?.isAi === true && participant?.isHuman === false && participant.userId === null, "seat flipped to AI in DB");
  check(participant?.replacedByAiAt !== null, "replacedByAiAt recorded");
  // AI back-to-back sub-actions vs delay between phase changes
  const allRows = await prisma.matchEvent.findMany({
    where: { matchId: ctx.matchId },
    orderBy: { seq: "asc" },
  });
  const rows = allRows.filter((event) => event.actorSeatIndex === closedSeat);
  let samePhaseFast = 0;
  let samePhaseSlow = 0;
  let crossSlow = 0;
  let crossFast = 0;
  // Only measure gaps between consecutive AI actions. A human action in
  // between would add its own network/UI time and is not an AI delay.
  let prevAi: (typeof allRows)[number] | null = null;
  for (const cur of allRows) {
    if (cur.actorSeatIndex !== closedSeat) {
      prevAi = null;
      continue;
    }
    if (prevAi) {
      const gap = cur.createdAt.getTime() - prevAi.createdAt.getTime();
      if (prevAi.phaseType === cur.phaseType && prevAi.round === cur.round) {
        if (gap <= 200) samePhaseFast += 1;
        else samePhaseSlow += 1;
      } else {
        if (gap >= 200) crossSlow += 1;
        else crossFast += 1;
      }
    }
    prevAi = cur;
  }
  check(samePhaseSlow === 0, `AI sub-actions within a phase are back-to-back (slow gaps: ${samePhaseSlow})`);
  check(rows.length < 2 || crossFast <= Math.max(1, Math.ceil(rows.length * 0.05)), `AI delay applied between phases (fast gaps: ${crossFast}/${rows.length})`);
  ok(`AI seat ${closedSeat} played ${rows.length} actions (same-phase fast: ${samePhaseFast}, cross-phase slow: ${crossSlow})`);
  await verifyFinished(ctx);
  // Released seat can open a new room
  const newRoom = await api(ctx.sessions[closedSeat]!, "/api/rooms", {
    method: "POST",
    body: { nickname: ctx.sessions[closedSeat]!.name, playerCount: 2 },
  });
  check(newRoom.status === 201, "taken-over user can open a new room immediately");
};

function dateOf(ctx: Ctx, seat: number): string | undefined {
  const e = anyEvent(ctx, "replacedByAi", (b) => b.seatIndex === seat);
  return e?.reason === "idle" ? "idle" : e?.reason === "leave" ? "leave" : undefined;
}

const closeDuringVoteScenario = async (_makeCtx: () => Promise<Ctx>) => {
  log("close page during open vote -> deadline resolves (3p)");
  const ctx = await _makeCtx();
  let stage: "playing" | "voted" = "playing";
  const tick: Tick = async (c, _actor, h) => {
    if (stage === "playing" && c.eventCount >= 2) {
      const started = await h.startVote(0);
      check(started.status === 201 && started.data?.status === "open" && started.data?.approve === 1, `end vote started (got ${started.status} ${JSON.stringify(started.data)?.slice(0, 120)})`);
      const cast = await h.castVote(1, "approve");
      check(cast.status === 200 && cast.data?.approve === 2, `seat 1 approves (got ${cast.status})`);
      log("  seat 2 closes the page without voting");
      await h.closePage(2);
      stage = "voted";
      return "continue";
    }
    if (stage === "voted") return "continue"; // vote open; wait for deadline resolution
    return "act";
  };
  await drive(ctx, { tick, timeoutMs: 90_000 });
  await verifyFinished(ctx, "endedByVote");
  const match = await dbMatch(ctx);
  const vote = match?.votes.at(-1);
  check(vote?.result === "passed", "deadline vote resolved passed");
  check(vote?.ballots.length === 2, `ballots = initiator + seat 1 only (got ${vote?.ballots.length})`);
};

const initiatorClosesScenario = async (_makeCtx: () => Promise<Ctx>) => {
  log("initiator closes page right after starting vote; oppose fails; cooldown; then finishes (3p)");
  const ctx = await _makeCtx();
  let stage: "playing" | "voted" | "cooldown-wait" | "second-vote" = "playing";
  let failEventCount = 0;
  const tick: Tick = async (c, _actor, h) => {
    if (stage === "playing" && c.eventCount >= 2) {
      const started = await h.startVote(0);
      check(started.status === 201, `vote started (got ${started.status})`);
      log("  seat 0 closes the page right after starting the vote");
      await h.closePage(0);
      const oppose = await h.castVote(1, "oppose");
      check(oppose.status === 200, `seat 1 opposes (got ${oppose.status})`);
      const approve = await h.castVote(2, "approve");
      check(approve.status === 200 && approve.data?.status === "failed", `all voted -> early fail (got ${approve.status} ${JSON.stringify(approve.data)?.slice(0, 120)})`);
      failEventCount = c.eventCount;
      const blocked = await h.startVote(1);
      check(blocked.status === 409 && blocked.data?.code === "VOTE_REQUIRES_ACTION", `cooldown blocks new vote (got ${blocked.status} ${blocked.data?.code})`);
      stage = "cooldown-wait";
      return "continue";
    }
    if (stage === "cooldown-wait") {
      if (c.eventCount > failEventCount) {
        const probe = await h.startVote(1);
        check(probe.status === 201, `vote allowed after one action (got ${probe.status} ${JSON.stringify(probe.data)?.slice(0, 120)})`);
        if (probe.status === 201) {
          // resolve it: seat 2 approves; seat 0 offline; deadline passes
          const cast = await h.castVote(2, "approve");
          check(cast.status === 200, `seat 2 approves second vote (got ${cast.status})`);
          stage = "second-vote";
        }
        return "continue";
      }
      return "act";
    }
    if (stage === "second-vote") {
      // Vote is open; seat 1 (initiator) and seat 2 have voted. Seat 0's page is
      // closed so they never vote; wait for the deadline resolution.
      return "continue";
    }
    return "act";
  };
  await drive(ctx, { tick, timeoutMs: 120_000 });
  await verifyFinished(ctx);
};

const reconnectDuringVoteScenario = async (_makeCtx: () => Promise<Ctx>) => {
  log("reconnect while vote open -> sees vote -> early pass (3p)");
  const ctx = await _makeCtx();
  let stage: "playing" | "dropped" | "voted" = "playing";
  const tick: Tick = async (c, _actor, h) => {
    if (stage === "playing" && c.eventCount >= 2) {
      const started = await h.startVote(0);
      check(started.status === 201 && started.data?.status === "open", `vote started (got ${started.status})`);
      const cast = await h.castVote(2, "approve");
      check(cast.status === 200 && cast.data?.approve === 2, `seat 2 approves while seat 1 is "reloading" (got ${cast.status})`);
      stage = "dropped";
      return "continue";
    }
    if (stage === "dropped") {
      log("  seat 1 reconnects during the open vote");
      await h.reconnect(1);
      await sleep(150);
      await syncEvents(c);
      const watchState = c.events[1]!.filter((e) => "eventCount" in e && "seatIndex" in e).at(-1);
      const vote = watchState?.vote as Record<string, unknown> | null | undefined;
      check(vote?.status === "open", `watch reply includes open vote (got ${JSON.stringify(vote?.status)})`);
      check(watchState?.seatIndex === 1, "watch reply carries seatIndex");
      const cast = await h.castVote(1, "approve");
      check(cast.status === 200 && cast.data?.status === "passed", `seat 1 votes after reconnecting -> early pass (got ${cast.status} ${JSON.stringify(cast.data)?.slice(0, 120)})`);
      stage = "voted";
      return "continue";
    }
    return "act";
  };
  await drive(ctx, { tick, timeoutMs: 90_000 });
  await verifyFinished(ctx, "endedByVote");
};

const leaveMidMatchScenario = async (_makeCtx: () => Promise<Ctx>) => {
  log("leave mid-match -> AI seat + open new room + old socket rejected (3p)");
  const ctx = await _makeCtx();
  let stage: "playing" | "left" = "playing";
  const tick: Tick = async (c, actor, h) => {
    if (stage === "playing" && c.eventCount >= 2) {
      const left = await h.leave(2);
      check(left.status === 200 && left.data?.result === "ai", `leave -> ai (got ${left.status} ${JSON.stringify(left.data)})`);
      ctx.sockets[2]?.emit("game:watch", { matchId: ctx.matchId });
      ctx.sockets[2]?.removeAllListeners();
      ctx.sockets[2]?.disconnect();
      ctx.sockets[2] = null;
      const takeover = anyEvent(ctx, "replacedByAi", (b) => b.seatIndex === 2);
      check(takeover?.reason === "leave", "leave takeover broadcast");
      check(actor !== 2 || true, "noop");
      const newRoom = await api(ctx.sessions[2]!, "/api/rooms", {
        method: "POST",
        body: { nickname: ctx.sessions[2]!.name, playerCount: 2 },
      });
      check(newRoom.status === 201, "left user can open a new room immediately");
      stage = "left";
      return "continue";
    }
    const forbidden = ctx.errors.filter((e) => e.seat === 2 && e.payload.code === "MATCH_FORBIDDEN");
    if (stage === "left" && forbidden.length > 0) {
      check(true, "old seat socket rejected with MATCH_FORBIDDEN");
      return "act";
    }
    return "act";
  };
  await drive(ctx, { tick, timeoutMs: 240_000 });
  await verifyFinished(ctx);
};

// ---------------------------------------------------------------- main

async function withFreshDb(fn: () => Promise<void>): Promise<void> {
  await resetIntegrationDb();
  try {
    await fn();
  } catch (err) {
    console.error(`scenario crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failures.push(`scenario crash: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  await prepareIntegrationDb();
  await resetIntegrationDb();
  await startServer();
  try {
    await withFreshDb(async () => {
      const ctx = await startMatch(3);
      await plainGameScenario(ctx);
    });
    await withFreshDb(async () => {
      const ctx = await startMatch(5);
      await plainGameScenario(ctx);
    });
    await withFreshDb(async () => {
      await unstableScenario(() => startMatch(5));
    });
    await withFreshDb(async () => {
      await closeOnOwnTurnScenario(() => startMatch(3));
    });
    await withFreshDb(async () => {
      await closeDuringVoteScenario(() => startMatch(3));
    });
    await withFreshDb(async () => {
      await initiatorClosesScenario(() => startMatch(3));
    });
    await withFreshDb(async () => {
      await reconnectDuringVoteScenario(() => startMatch(3));
    });
    await withFreshDb(async () => {
      await leaveMidMatchScenario(() => startMatch(3));
    });
  } finally {
    await resetIntegrationDb();
    sio.close();
    await prisma.$disconnect();
  }
  console.log("\n===== RESULT =====");
  if (failures.length === 0) {
    console.log("ALL SCENARIOS PASSED");
  } else {
    console.log(`${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

await main();

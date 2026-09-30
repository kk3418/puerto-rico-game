import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyAction, createInitialState, getActorIndex, getLegalActions, type Action } from "../../../src/engine";
import { createApp } from "../app";
import { prisma } from "../db";
import { describeActionContext } from "../matches/replay";
import { guestAgent, prepareIntegrationDb, resetIntegrationDb, testApp, type TestAgent } from "../test/harness";
import { attachGameServer } from "./gameServer";
import { clearLiveMatches } from "./liveMatches";

const ready = await prepareIntegrationDb();

const SEED = 11;
const NAMES = ["__sk__a", "__sk__b", "__sk__c"];

function openingSetup() {
  const start = createInitialState({
    playerCount: 3,
    difficulty: "balanced",
    seed: SEED,
    humanName: NAMES[0]!,
    seatNames: NAMES,
  });
  const actorSeat = getActorIndex(start);
  const legal = getLegalActions(start);
  const action = legal[0];
  if (actorSeat === null || !action) throw new Error("no opening action");
  return { start, actorSeat, action };
}

async function guestSession(nickname: string): Promise<{ guestId: string; cookie: string; agent: TestAgent }> {
  const agent = testApp();
  const res = await agent.post("/api/auth/guest").send({ nickname }).expect(200);
  const guestId = res.body.guest?.id as string | undefined;
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = raw?.split(";")[0];
  if (!guestId || !cookie) throw new Error("guest session missing id or cookie");
  return { guestId, cookie, agent };
}

describe.skipIf(!ready)("socket play integration", () => {
  let server: http.Server;
  let io: ReturnType<typeof attachGameServer>;
  let port: number;
  let clients: Socket[];

  beforeAll(async () => {
    clients = [];
    server = http.createServer(createApp());
    io = attachGameServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients = [];
    clearLiveMatches();
    await resetIntegrationDb();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
    await prisma.$disconnect();
  });

  function connect(cookie: string): Promise<Socket> {
    const socket = ioc(`http://127.0.0.1:${port}`, {
      extraHeaders: { cookie },
      reconnection: false,
    });
    clients.push(socket);
    return new Promise((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", (err) => reject(err));
    });
  }

  function waitFor<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 8000);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  async function createOnlineMatch(guestIds: string[]) {
    return prisma.match.create({
      data: {
        mode: "online",
        status: "playing",
        playerCount: 3,
        difficulty: "balanced",
        seed: SEED,
        humanName: NAMES[0]!,
        participants: {
          create: NAMES.map((nickname, seatIndex) => ({
            seatIndex,
            nickname,
            guestId: guestIds[seatIndex] ?? null,
            isHuman: true,
            isAi: false,
          })),
        },
      },
      include: { participants: { orderBy: { seatIndex: "asc" } } },
    });
  }

  it("rejects socket connections without a session", async () => {
    const socket = ioc(`http://127.0.0.1:${port}`, { reconnection: false });
    clients.push(socket);
    const err = await new Promise<Error & { data?: { code?: string } }>((resolve) => {
      socket.once("connect_error", resolve);
    });
    expect(err.data?.code).toBe("AUTH_REQUIRED");
  });

  it("rejects non-actor and illegal actions, applies a legal action, and redacts state", async () => {
    const { start, actorSeat, action } = openingSetup();
    expect(actorSeat).toBe(0);

    const guestA = await guestSession(NAMES[0]!);
    const guestB = await guestSession(NAMES[1]!);
    const match = await createOnlineMatch([guestA.guestId, guestB.guestId, "__sk__ghost"]);

    const clientA = await connect(guestA.cookie);
    const clientB = await connect(guestB.cookie);

    const watchA = waitFor<{ seatIndex: number; eventCount: number }>(clientA, "game:state");
    clientA.emit("game:watch", { matchId: match.id });
    const viewA = await watchA;
    expect(viewA.seatIndex).toBe(0);
    expect(viewA.eventCount).toBe(0);

    const watchB = waitFor<{ seatIndex: number }>(clientB, "game:state");
    clientB.emit("game:watch", { matchId: match.id });
    expect((await watchB).seatIndex).toBe(1);

    const notActor = waitFor<{ code?: string }>(clientB, "game:error");
    clientB.emit("game:action", { matchId: match.id, action });
    expect((await notActor).code).toBe("NOT_YOUR_TURN");

    const illegal = waitFor<{ code?: string }>(clientA, "game:error");
    clientA.emit("game:action", { matchId: match.id, action: { type: "mayorDone" } });
    expect((await illegal).code).toBe("ILLEGAL_ACTION");

    const nextState = applyAction(start, action);
    const stateA = waitFor<Record<string, unknown>>(clientA, "game:state");
    const stateB = waitFor<Record<string, unknown>>(clientB, "game:state");
    clientA.emit("game:action", { matchId: match.id, action });
    const [broadcastA, broadcastB] = await Promise.all([stateA, stateB]);

    for (const broadcast of [broadcastA, broadcastB]) {
      expect(broadcast.matchId).toBe(match.id);
      expect(broadcast.eventCount).toBe(1);
      const state = broadcast.state as Record<string, unknown>;
      expect(state.plantationDeck).toEqual([]);
      expect(state.plantationDeckCount).toBe(nextState.plantationDeck.length);
      expect(state.plantationDiscard).toEqual([]);
      expect("rng" in state).toBe(false);
      expect(state.phase).toEqual(nextState.phase);
      const legalActions = broadcast.legalActions as Action[];
      expect(Array.isArray(legalActions)).toBe(true);
      expect(legalActions.length).toBeGreaterThan(0);
    }

    const stored = await prisma.matchEvent.findUnique({
      where: { matchId_seq: { matchId: match.id, seq: 1 } },
    });
    const meta = describeActionContext(start);
    expect(stored).not.toBeNull();
    expect(stored!.actorSeatIndex).toBe(meta!.actorSeatIndex);
    expect(stored!.round).toBe(meta!.round);
    expect(stored!.phaseType).toBe(meta!.phaseType);
    expect(stored!.action).toEqual(action);
  });

  it("keeps online matches server-authoritative over HTTP", async () => {
    const { action } = openingSetup();
    const guestA = await guestSession(NAMES[0]!);
    const guestB = await guestSession(NAMES[1]!);
    const match = await createOnlineMatch([guestA.guestId, guestB.guestId, "__sk__ghost"]);

    const anonymous = await testApp()
      .post(`/api/matches/${match.id}/events`)
      .send({ playToken: "ignored", events: [{ seq: 1, action }] })
      .expect(401);
    expect(anonymous.body.code).toBe("AUTH_REQUIRED");

    const write = await guestB.agent
      .post(`/api/matches/${match.id}/events`)
      .send({ playToken: "ignored", events: [{ seq: 1, action }] })
      .expect(409);
    expect(write.body.code).toBe("MATCH_SERVER_AUTHORITATIVE");

    const state = await guestB.agent.get(`/api/matches/${match.id}/state`).expect(200);
    expect(state.body.seatIndex).toBe(1);
    expect(state.body.playToken).toBeUndefined();
    expect(state.body.state.plantationDeck).toEqual([]);
    expect(state.body.state.plantationDeckCount).toBeGreaterThan(0);
    expect("rng" in state.body.state).toBe(false);
    expect(Array.isArray(state.body.legalActions)).toBe(true);

    const stranger = await guestAgent("__sk__stranger");
    const forbidden = await stranger.get(`/api/matches/${match.id}/state`).expect(403);
    expect(forbidden.body.code).toBe("MATCH_FORBIDDEN");

    expect(guestA.guestId).not.toBe(guestB.guestId);
  });
});

import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyAction, createInitialState, getActorIndex, getLegalActions, type Action } from "../../../src/engine";
import { createApp } from "../app";
import { prisma } from "../db";
import { describeActionContext } from "../matches/replay";
import { prepareIntegrationDb, resetIntegrationDb, testApp, userAgent, userSession } from "../test/harness";
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

  async function createOnlineMatch(userIds: Array<string | null>) {
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
            userId: userIds[seatIndex] ?? null,
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
    expect(err.data?.code).toBe("LOGIN_REQUIRED");
  });

  it("rejects non-actor and illegal actions, applies a legal action, and redacts state", async () => {
    const { start, actorSeat, action } = openingSetup();
    expect(actorSeat).toBe(0);

    const guestA = await userSession(NAMES[0]!);
    const guestB = await userSession(NAMES[1]!);
    const match = await createOnlineMatch([guestA.userId, guestB.userId, null]);

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

  it("serializes a player leaving with a live action", async () => {
    const { action } = openingSetup();
    const userA = await userSession(NAMES[0]!);
    const userB = await userSession(NAMES[1]!);
    const match = await createOnlineMatch([userA.userId, userB.userId, null]);

    const clientA = await connect(userA.cookie);
    const clientB = await connect(userB.cookie);
    const watchA = waitFor(clientA, "game:state");
    clientA.emit("game:watch", { matchId: match.id });
    await watchA;
    const watchB = waitFor(clientB, "game:state");
    clientB.emit("game:watch", { matchId: match.id });
    await watchB;

    const acted = new Promise<{ eventCount: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for eventCount 1")), 8000);
      clientA.on("game:state", (payload: { eventCount?: number }) => {
        if (payload.eventCount !== 1) return;
        clearTimeout(timer);
        resolve(payload as { eventCount: number });
      });
    });
    clientA.emit("game:action", { matchId: match.id, action });
    const leave = userB.agent.post(`/api/matches/${match.id}/leave`);

    const [state, left] = await Promise.all([acted, leave]);
    expect(state.eventCount).toBe(1);
    expect(left.status).toBe(200);
    expect(left.body.result).toBe("ai");

    const stored = await prisma.match.findUnique({
      where: { id: match.id },
      include: { participants: { orderBy: { seatIndex: "asc" } } },
    });
    expect(stored?.status).toBe("playing");
    expect(stored?.participants[1]).toMatchObject({ isHuman: false, isAi: true, userId: null });
    expect(await prisma.matchEvent.count({ where: { matchId: match.id } })).toBe(1);
  });

  it("rejects game actions while an end vote is open", async () => {
    const { action } = openingSetup();
    const userA = await userSession(NAMES[0]!);
    const userB = await userSession(NAMES[1]!);
    const match = await createOnlineMatch([userA.userId, userB.userId, null]);

    const clientA = await connect(userA.cookie);
    const clientB = await connect(userB.cookie);
    const watchA = waitFor(clientA, "game:state");
    clientA.emit("game:watch", { matchId: match.id });
    await watchA;
    const watchB = waitFor(clientB, "game:state");
    clientB.emit("game:watch", { matchId: match.id });
    await watchB;

    const vote = waitFor<{ vote: { status: string } }>(clientA, "game:vote");
    await userA.agent.post(`/api/matches/${match.id}/end-vote`).expect(201);
    expect((await vote).vote.status).toBe("open");

    const error = waitFor<{ code?: string }>(clientA, "game:error");
    clientA.emit("game:action", { matchId: match.id, action });
    expect((await error).code).toBe("VOTE_IN_PROGRESS");
    expect(await prisma.matchEvent.count({ where: { matchId: match.id } })).toBe(0);
  });

  it("keeps online matches server-authoritative over HTTP", async () => {
    const { action } = openingSetup();
    const guestA = await userSession(NAMES[0]!);
    const guestB = await userSession(NAMES[1]!);
    const match = await createOnlineMatch([guestA.userId, guestB.userId, null]);

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

    const stranger = await userAgent("__sk__stranger");
    const forbidden = await stranger.get(`/api/matches/${match.id}/state`).expect(403);
    expect(forbidden.body.code).toBe("MATCH_FORBIDDEN");

    expect(guestA.userId).not.toBe(guestB.userId);
  });
});

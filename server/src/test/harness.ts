import { execSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { HeuristicAgent } from "../../../src/agents/heuristic";
import {
  applyAction,
  createInitialState,
  getActorIndex,
  getLegalActions,
  scoreGame,
  type Action,
  type Difficulty,
  type PlayerCount,
} from "../../../src/engine";
import type { MatchEventInput } from "../../../src/api/types";
import { createApp } from "../app";
import { prisma } from "../db";
import { env } from "../env";
import { clearAllMatchTimers } from "../live/matchRuntime";
import { clearLiveMatches } from "../live/liveMatches";
import { replayCache } from "../matches/replayCache";

export type TestAgent = ReturnType<typeof request.agent>;

export function testApp() {
  return request.agent(createApp());
}

function integrationSchema(): string {
  const schema = new URL(env.DATABASE_URL).searchParams.get("schema") ?? "itest";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`unexpected integration schema name: ${schema}`);
  }
  return schema;
}

function adminDatabaseUrl(): string {
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete("schema");
  return url.toString();
}

export async function prepareIntegrationDb(): Promise<boolean> {
  const admin = new PrismaClient({
    datasources: { db: { url: adminDatabaseUrl() } },
  });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${integrationSchema()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Skipping HTTP integration tests (Postgres unavailable): ${message}`);
    return false;
  } finally {
    await admin.$disconnect();
  }

  try {
    execSync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
    await prisma.$connect();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Skipping HTTP integration tests (migrate failed): ${message}`);
    return false;
  }
}

export async function resetIntegrationDb(): Promise<void> {
  clearAllMatchTimers();
  clearLiveMatches();
  replayCache.clear();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "MatchVoteBallot",
      "MatchVote",
      "MatchEvent",
      "MatchSave",
      "MatchParticipant",
      "Match",
      "UserStats",
      "AccountProvider",
      "Session",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

export async function guestAgent(nickname: string): Promise<TestAgent> {
  const agent = testApp();
  const res = await agent.post("/api/auth/guest").send({ nickname }).expect(200);
  if (!res.body.guest?.id) throw new Error("guest session missing id");
  return agent;
}

function signedSessionCookie(sid: string): string {
  const signature = createHmac("sha256", env.SESSION_SECRET).update(sid).digest("base64").replace(/=+$/, "");
  return `s:${sid}.${signature}`;
}

/**
 * A logged-in browser session, seeded the same way the OAuth callback would.
 * Online play requires a real user, so integration tests cannot use guests.
 */
export async function userSession(
  displayName: string,
): Promise<{ userId: string; cookie: string; agent: TestAgent }> {
  const user = await prisma.user.create({
    data: {
      email: `${displayName}@itest.local`,
      displayName,
      accounts: { create: { provider: "google", providerAccountId: `itest-${displayName}` } },
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
  } as unknown as Prisma.InputJsonValue;
  await prisma.session.create({ data: { sid, sess, expire } });
  const cookie = `pr.sid=${signedSessionCookie(sid)}`;
  const agent = testApp();
  agent.set("Cookie", cookie);
  return { userId: user.id, cookie, agent };
}

export async function userAgent(displayName: string): Promise<TestAgent> {
  return (await userSession(displayName)).agent;
}

export async function createGuestMatch(
  agent: TestAgent,
  input: {
    nickname: string;
    playerCount?: PlayerCount;
    difficulty?: Difficulty;
    seed?: number;
  },
) {
  const res = await agent
    .post("/api/matches")
    .send({
      nickname: input.nickname,
      playerCount: input.playerCount ?? 3,
      difficulty: input.difficulty ?? "balanced",
      seed: input.seed ?? 2024,
    })
    .expect(201);
  return res.body as {
    id: string;
    eventCount: number;
    seed: number;
    humanName: string;
    playToken: string;
    joinCode: string | null;
    hostSeatIndex: number | null;
  };
}

export async function recordSoloActions(input: {
  playerCount?: PlayerCount;
  difficulty?: Difficulty;
  seed: number;
  humanName: string;
}): Promise<{ events: MatchEventInput[]; scores: ReturnType<typeof scoreGame> }> {
  let state = createInitialState({
    playerCount: input.playerCount ?? 3,
    difficulty: input.difficulty ?? "balanced",
    seed: input.seed,
    humanName: input.humanName,
  });
  state = { ...state, players: state.players.map((p) => ({ ...p, isHuman: false })) };
  const ai = new HeuristicAgent();
  const events: MatchEventInput[] = [];
  let guard = 0;
  while (!state.gameOver && guard++ < 5000) {
    const legal = getLegalActions(state);
    const idx = getActorIndex(state);
    if (legal.length === 0 || idx === null) break;
    const action = await ai.chooseAction({
      state,
      legalActions: legal,
      playerId: state.players[idx]!.id,
    });
    events.push({
      seq: events.length + 1,
      round: state.round,
      phaseType: state.phase.type,
      activeRole: state.activeRole,
      actorSeatIndex: idx,
      action,
    });
    state = applyAction(state, action);
  }
  if (!state.gameOver) throw new Error("failed to finish recorded game");
  return { events, scores: scoreGame(state) };
}

export async function postEventChunks(
  agent: TestAgent,
  matchId: string,
  events: MatchEventInput[],
  playToken: string,
) {
  const size = 200;
  for (let i = 0; i < events.length; i += size) {
    await agent
      .post(`/api/matches/${matchId}/events`)
      .send({ playToken, events: events.slice(i, i + size) })
      .expect(200);
  }
}

export function firstLegalAction(seed: number, humanName: string): Action {
  const start = createInitialState({
    playerCount: 3,
    difficulty: "balanced",
    seed,
    humanName,
  });
  const action = getLegalActions(start)[0];
  if (!action) throw new Error("no legal opening action");
  return action;
}

export function secondLegalAction(seed: number, humanName: string): Action {
  const start = createInitialState({
    playerCount: 3,
    difficulty: "balanced",
    seed,
    humanName,
  });
  const action = getLegalActions(start)[1];
  if (!action) throw new Error("need at least two opening roles");
  return action;
}

export function openingEvent(action: Action, seq = 1): MatchEventInput {
  return {
    seq,
    round: 1,
    phaseType: "chooseRole",
    activeRole: null,
    actorSeatIndex: 0,
    action,
  };
}

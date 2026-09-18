import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
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
import { replayCache } from "../matches/replayCache";

export type TestAgent = ReturnType<typeof request.agent>;

export function testApp() {
  return request.agent(createApp());
}

function adminDatabaseUrl(): string {
  return env.DATABASE_URL.replace(/[?&]schema=itest/, "").replace(/\?$/, "");
}

export async function prepareIntegrationDb(): Promise<boolean> {
  const admin = new PrismaClient({
    datasources: { db: { url: adminDatabaseUrl() } },
  });
  try {
    await admin.$executeRawUnsafe("CREATE SCHEMA IF NOT EXISTS itest");
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
  replayCache.clear();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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
  return res.body as { id: string; eventCount: number; seed: number; humanName: string };
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

export async function postEventChunks(agent: TestAgent, matchId: string, events: MatchEventInput[]) {
  const size = 200;
  for (let i = 0; i < events.length; i += size) {
    await agent.post(`/api/matches/${matchId}/events`).send({ events: events.slice(i, i + size) }).expect(200);
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

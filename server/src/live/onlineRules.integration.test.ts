import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getActorIndex, type GameState } from "../../../src/engine";
import { prisma } from "../db";
import { clearAllMatchTimers, reconcileOnlineMatches } from "../live/matchRuntime";
import { prepareIntegrationDb, resetIntegrationDb, userSession, type TestAgent } from "../test/harness";

const ready = await prepareIntegrationDb();

let nameSeq = 0;
function nextName(prefix: string): string {
  nameSeq += 1;
  return `__or_${prefix}_${nameSeq}__`;
}

type Session = { userId: string; cookie: string; agent: TestAgent; name: string };

async function session(prefix: string): Promise<Session> {
  const name = nextName(prefix);
  const created = await userSession(name);
  return { ...created, name };
}

async function startedMatch(playerCount: 2 | 3): Promise<{ sessions: Session[]; matchId: string }> {
  const sessions: Session[] = [];
  for (let i = 0; i < playerCount; i++) sessions.push(await session(`p${i}`));
  const host = sessions[0]!;
  const room = await host.agent
    .post("/api/rooms")
    .send({ nickname: host.name, playerCount })
    .expect(201);
  for (let i = 1; i < playerCount; i++) {
    const guest = sessions[i]!;
    await guest.agent
      .post("/api/rooms/join")
      .send({ nickname: guest.name, roomId: room.body.id })
      .expect(200);
  }

  let status = "lobby";
  for (let round = 0; round < 4 && status !== "playing"; round++) {
    for (const agentSession of sessions) {
      const beat = await agentSession.agent
        .post(`/api/rooms/${room.body.id}/heartbeat`)
        .send({ ready: true })
        .expect(200);
      status = beat.body.status;
    }
  }
  expect(status).toBe("playing");
  return { sessions, matchId: room.body.id as string };
}

async function liveState(matchId: string, actor: Session): Promise<{
  state: GameState;
  seatIndex: number;
  legalActions: unknown[];
}> {
  const res = await actor.agent.get(`/api/matches/${matchId}/state`).expect(200);
  return res.body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!ready)("online match rules", () => {
  afterEach(async () => {
    delete process.env.ONLINE_IDLE_MS;
    delete process.env.ONLINE_AI_DELAY_MS;
    delete process.env.ONLINE_VOTE_MS;
    await resetIntegrationDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("blocks a seated player with the blocking match and releases the seat on leave", async () => {
    const host = await session("host");
    const guest = await session("guest");
    const room = await host.agent
      .post("/api/rooms")
      .send({ nickname: host.name, playerCount: 3 })
      .expect(201);
    await guest.agent
      .post("/api/rooms/join")
      .send({ nickname: guest.name, roomId: room.body.id })
      .expect(200);

    const hostBlocked = await host.agent
      .post("/api/rooms")
      .send({ nickname: host.name, playerCount: 2 })
      .expect(409);
    expect(hostBlocked.body.code).toBe("ROOM_ALREADY_IN_MATCH");
    expect(hostBlocked.body.params).toMatchObject({
      matchId: room.body.id,
      status: "lobby",
      isHost: 1,
    });

    const guestBlocked = await guest.agent
      .post("/api/rooms")
      .send({ nickname: guest.name, playerCount: 2 })
      .expect(409);
    expect(guestBlocked.body.code).toBe("ROOM_ALREADY_IN_MATCH");
    expect(guestBlocked.body.params).toMatchObject({
      matchId: room.body.id,
      status: "lobby",
      isHost: 0,
    });

    const other = await session("other");
    const target = await other.agent
      .post("/api/rooms")
      .send({ nickname: other.name, playerCount: 3 })
      .expect(201);
    const joinBlocked = await guest.agent
      .post("/api/rooms/join")
      .send({ nickname: guest.name, roomId: target.body.id })
      .expect(409);
    expect(joinBlocked.body.code).toBe("ROOM_ALREADY_IN_MATCH");
    expect(joinBlocked.body.params).toMatchObject({
      matchId: room.body.id,
      status: "lobby",
      isHost: 0,
    });

    await guest.agent.post(`/api/rooms/${room.body.id}/leave`).expect(200);
    const guestRoom = await guest.agent
      .post("/api/rooms")
      .send({ nickname: guest.name, playerCount: 2 })
      .expect(201);
    expect(guestRoom.body.id).not.toBe(room.body.id);

    // The host is still seated in the old room, so opening another one is blocked too.
    const stillBlocked = await host.agent
      .post("/api/rooms")
      .send({ nickname: host.name, playerCount: 2 })
      .expect(409);
    expect(stillBlocked.body.params.isHost).toBe(1);

    await host.agent.post(`/api/rooms/${room.body.id}/leave`).expect(200);
    expect(await prisma.match.findUnique({ where: { id: room.body.id } })).toBeNull();
    const hostRoom = await host.agent
      .post("/api/rooms")
      .send({ nickname: host.name, playerCount: 2 })
      .expect(201);
    expect(hostRoom.body.id).not.toBe(room.body.id);
  });

  it("hands a leaving playing seat to AI and lets that player start another room", async () => {
    const { sessions, matchId } = await startedMatch(3);
    const [host, guest] = sessions;
    const seat = (await liveState(matchId, host!)).state.players.findIndex((p) => p.name === guest!.name);
    expect(seat).toBeGreaterThanOrEqual(0);

    const left = await guest!.agent.post(`/api/matches/${matchId}/leave`).expect(200);
    expect(left.body.result).toBe("ai");

    const participant = await prisma.matchParticipant.findFirst({
      where: { matchId, seatIndex: seat },
    });
    expect(participant).toMatchObject({ isHuman: false, isAi: true, userId: null });
    expect(participant?.replacedByAiAt).not.toBeNull();

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe("playing");

    const replacedSeat = await guest!.agent.get(`/api/matches/${matchId}/seat`).expect(200);
    expect(replacedSeat.body).toMatchObject({
      status: "replaced",
      matchId,
      matchStatus: "playing",
      seat: {
        seatIndex: seat,
        isHuman: false,
        isAi: true,
        replacedFromUserId: guest!.userId,
      },
    });
    const currentSeat = await host!.agent.get(`/api/matches/${matchId}/seat`).expect(200);
    expect(currentSeat.body).toMatchObject({ status: "seated", matchStatus: "playing" });
    const stranger = await session("stranger");
    await stranger.agent.get(`/api/matches/${matchId}/seat`).expect(404);

    const after = await liveState(matchId, host!);
    expect(after.state.players[seat]?.isHuman).toBe(false);

    const nextRoom = await guest!.agent
      .post("/api/rooms")
      .send({ nickname: guest!.name, playerCount: 2 })
      .expect(201);
    expect(nextRoom.body.id).not.toBe(matchId);
  });

  it("does not abandon a three-player match when the host leaves", async () => {
    const { sessions, matchId } = await startedMatch(3);
    const [host] = sessions;

    const left = await host!.agent.post(`/api/matches/${matchId}/leave`).expect(200);
    expect(left.body.result).toBe("ai");

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe("playing");
    const seat = await prisma.matchParticipant.findFirst({
      where: { matchId, seatIndex: 0 },
    });
    expect(seat).toMatchObject({ isHuman: false, isAi: true, userId: null });

    const nextRoom = await host!.agent
      .post("/api/rooms")
      .send({ nickname: host!.name, playerCount: 2 })
      .expect(201);
    expect(nextRoom.body.id).not.toBe(matchId);
  });

  it("abandons a two-player match when one player leaves", async () => {
    const { sessions, matchId } = await startedMatch(2);
    const [host, guest] = sessions;

    const left = await guest!.agent.post(`/api/matches/${matchId}/leave`).expect(200);
    expect(left.body.result).toBe("abandoned");

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe("abandoned");
    expect(match?.endedAt).not.toBeNull();

    const nextRoom = await guest!.agent
      .post("/api/rooms")
      .send({ nickname: guest!.name, playerCount: 2 })
      .expect(201);
    expect(nextRoom.body.id).not.toBe(matchId);
    expect(host!.userId).not.toBe(guest!.userId);
  });

  it("passes an end vote and scores the unfinished match", async () => {
    const { sessions, matchId } = await startedMatch(2);
    const [host, guest] = sessions;

    const started = await host!.agent.post(`/api/matches/${matchId}/end-vote`).expect(201);
    expect(started.body).toMatchObject({
      status: "open",
      initiatedBySeat: 0,
      approve: 1,
      oppose: 0,
    });

    const passed = await guest!.agent
      .post(`/api/matches/${matchId}/end-vote/vote`)
      .send({ choice: "approve" })
      .expect(200);
    expect(passed.body).toMatchObject({ status: "passed", result: "passed", approve: 2 });

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { participants: true },
    });
    expect(match?.status).toBe("finished");
    expect(match?.verified).toBe(true);
    expect(match?.endReason).toBe("endedByVote");
    expect(match?.participants.every((p) => p.total !== null)).toBe(true);
  });

  it("resolves an end vote at the deadline when some players do not vote", async () => {
    process.env.ONLINE_VOTE_MS = "100";
    const { sessions, matchId } = await startedMatch(3);
    const [host] = sessions;

    await host!.agent.post(`/api/matches/${matchId}/end-vote`).expect(201);

    let vote = null;
    let match = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      vote = await prisma.matchVote.findFirst({
        where: { matchId },
        orderBy: { createdAt: "desc" },
      });
      match = await prisma.match.findUnique({ where: { id: matchId } });
      if (vote?.result === "passed" && match?.status === "finished") break;
      await sleep(25);
    }
    expect(vote?.result).toBe("passed");
    expect(match?.status).toBe("finished");
  });

  it("keeps the match going when one player opposes the end vote", async () => {
    const { sessions, matchId } = await startedMatch(3);
    const [host, guest, third] = sessions;

    await host!.agent.post(`/api/matches/${matchId}/end-vote`).expect(201);
    await guest!.agent
      .post(`/api/matches/${matchId}/end-vote/vote`)
      .send({ choice: "oppose" })
      .expect(200);
    const failed = await third!.agent
      .post(`/api/matches/${matchId}/end-vote/vote`)
      .send({ choice: "approve" })
      .expect(200);
    expect(failed.body).toMatchObject({ status: "failed", result: "failed", oppose: 1, approve: 2 });

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe("playing");

    const blocked = await host!.agent.post(`/api/matches/${matchId}/end-vote`).expect(409);
    expect(blocked.body.code).toBe("VOTE_REQUIRES_ACTION");

    const left = await guest!.agent.post(`/api/matches/${matchId}/leave`).expect(200);
    expect(left.body.result).toBe("ai");
    const after = await prisma.match.findUnique({ where: { id: matchId } });
    expect(after?.status).toBe("playing");
  });

  it("abandons the match when a vote has no valid ballots", async () => {
    const { sessions, matchId } = await startedMatch(3);
    const [host] = sessions;

    await host!.agent.post(`/api/matches/${matchId}/end-vote`).expect(201);
    const left = await host!.agent.post(`/api/matches/${matchId}/leave`).expect(200);
    expect(left.body.result).toBe("abandoned");

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { votes: true },
    });
    expect(match?.status).toBe("abandoned");
    expect(match?.votes.at(-1)?.result).toBe("abandoned");
  });

  it("pauses the idle timer during a vote instead of resetting it", async () => {
    process.env.ONLINE_IDLE_MS = "4000";
    process.env.ONLINE_VOTE_MS = "800";
    const { sessions, matchId } = await startedMatch(3);
    const [host, guest] = sessions;
    const before = await liveState(matchId, host!);
    const actor = getActorIndex(before.state);
    expect(actor).not.toBeNull();

    // Halfway through the idle window, open a vote and let it run to the deadline.
    await sleep(1000);
    await host!.agent.post(`/api/matches/${matchId}/end-vote`).expect(201);
    await guest!.agent
      .post(`/api/matches/${matchId}/end-vote/vote`)
      .send({ choice: "oppose" })
      .expect(200);
    await expect
      .poll(
        async () =>
          (
            await prisma.matchVote.findFirst({
              where: { matchId },
              orderBy: { createdAt: "desc" },
            })
          )?.result,
        { timeout: 3000 },
      )
      .toBe("failed");

    const shortlyAfter = await prisma.matchParticipant.findFirst({
      where: { matchId, seatIndex: actor! },
    });
    expect(shortlyAfter?.isAi).toBe(false);

    // The remaining idle time is the original remainder, not a fresh full window.
    await sleep(3400);
    const later = await prisma.matchParticipant.findFirst({
      where: { matchId, seatIndex: actor! },
    });
    expect(later?.isAi).toBe(true);
  }, 15_000);

  it("restores idle takeover after a simulated server restart", async () => {
    process.env.ONLINE_IDLE_MS = "80";
    process.env.ONLINE_AI_DELAY_MS = "15";
    const { sessions, matchId } = await startedMatch(3);
    const [host] = sessions;
    const actor = getActorIndex((await liveState(matchId, host!)).state);
    expect(actor).not.toBeNull();

    clearAllMatchTimers();
    await reconcileOnlineMatches();

    let participant = null;
    let events = 0;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      participant = await prisma.matchParticipant.findFirst({
        where: { matchId, seatIndex: actor! },
      });
      events = await prisma.matchEvent.count({ where: { matchId } });
      if (participant?.isAi && events > 0) break;
      await sleep(25);
    }

    expect(participant).toMatchObject({ isHuman: false, isAi: true });
    expect(events).toBeGreaterThan(0);
  });

  it("resolves an expired vote after a simulated server restart", async () => {
    process.env.ONLINE_VOTE_MS = "60";
    const { sessions, matchId } = await startedMatch(3);
    const [host] = sessions;

    await host!.agent.post(`/api/matches/${matchId}/end-vote`).expect(201);
    await sleep(100);
    clearAllMatchTimers();
    await reconcileOnlineMatches();

    await expect
      .poll(
        async () =>
          (
            await prisma.matchVote.findFirst({
              where: { matchId },
              orderBy: { createdAt: "desc" },
            })
          )?.result,
        { timeout: 3000 },
      )
      .not.toBeNull();
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe("finished");
  });

  it("takes over an idle acting seat with AI and lets the AI act", async () => {
    process.env.ONLINE_IDLE_MS = "80";
    process.env.ONLINE_AI_DELAY_MS = "15";
    const { sessions, matchId } = await startedMatch(3);
    const [host] = sessions;

    const before = await liveState(matchId, host!);
    const actor = getActorIndex(before.state);
    expect(actor).not.toBeNull();

    let participant = null;
    let events = 0;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      participant = await prisma.matchParticipant.findFirst({
        where: { matchId, seatIndex: actor! },
      });
      events = await prisma.matchEvent.count({ where: { matchId } });
      if (participant?.isAi && events > 0) break;
      await sleep(25);
    }

    expect(participant).toMatchObject({ isHuman: false, isAi: true, userId: null });
    expect(events).toBeGreaterThan(0);
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe("playing");
  });
});

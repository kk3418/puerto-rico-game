import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { applyAction, createInitialState, getLegalActions } from "../../src/engine";
import { findOrCreateUser } from "./auth/accounts";
import { prisma } from "./db";
import { describeActionContext } from "./matches/replay";
import {
  createGuestMatch,
  firstLegalAction,
  guestAgent,
  openingEvent,
  postEventChunks,
  prepareIntegrationDb,
  recordSoloActions,
  resetIntegrationDb,
  secondLegalAction,
  testApp,
} from "./test/harness";

const ready = await prepareIntegrationDb();

describe.skipIf(!ready)("HTTP integration", () => {
  afterEach(async () => {
    await resetIntegrationDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects match writes without a session", async () => {
    await testApp().post("/api/matches").send({ nickname: "__it__n", playerCount: 3, difficulty: "balanced" }).expect(401);
  });

  it("lets a guest read their match and forbids another guest", async () => {
    const owner = await guestAgent("__it__owner");
    const other = await guestAgent("__it__other");
    const match = await createGuestMatch(owner, { nickname: "__it__owner", seed: 11 });

    const ok = await owner.get(`/api/matches/${match.id}`).expect(200);
    expect(ok.body.id).toBe(match.id);

    const forbidden = await other.get(`/api/matches/${match.id}`).expect(403);
    expect(forbidden.body.error).toBe("無權存取此對局");
  });

  it("appends contiguous events, ignores identical duplicates, and rejects gaps or illegal actions", async () => {
    const nickname = "__it__events";
    const agent = await guestAgent(nickname);
    const match = await createGuestMatch(agent, { nickname, seed: 7 });
    const first = firstLegalAction(7, nickname);
    const alt = secondLegalAction(7, nickname);
    const play = { playToken: match.playToken };

    await agent
      .post(`/api/matches/${match.id}/events`)
      .send({ ...play, events: [openingEvent({ type: "mayorDone" })] })
      .expect(400);

    await agent
      .post(`/api/matches/${match.id}/events`)
      .send({ ...play, events: [openingEvent(first, 2)] })
      .expect(409);

    await agent
      .post(`/api/matches/${match.id}/events`)
      .send({ playToken: "stale-token", events: [openingEvent(first)] })
      .expect(409);

    await agent
      .post(`/api/matches/${match.id}/events`)
      .send({
        ...play,
        events: [
          {
            seq: 1,
            round: 99,
            phaseType: "captainLoad",
            activeRole: "captain",
            actorSeatIndex: 4,
            actorUserId: "spoofed-user",
            action: first,
          },
        ],
      })
      .expect(200);

    const dup = await agent
      .post(`/api/matches/${match.id}/events`)
      .send({ ...play, events: [openingEvent(first)] })
      .expect(200);
    expect(dup.body.appended).toBe(0);
    expect(dup.body.eventCount).toBe(1);

    await agent
      .post(`/api/matches/${match.id}/events`)
      .send({ ...play, events: [openingEvent(alt)] })
      .expect(409);

    const live = await agent.get(`/api/matches/${match.id}/state`).expect(200);
    expect(live.body.state.gameOver).toBe(false);
    expect(live.body.eventCount).toBe(1);
    expect(live.body.playToken).toBeTruthy();
    expect(live.body.playToken).not.toBe(match.playToken);

    const stale = await agent
      .post(`/api/matches/${match.id}/events`)
      .send({ playToken: match.playToken, events: [openingEvent(first)] })
      .expect(409);
    expect(stale.body.error).toMatch(/另一個視窗/);

    const stored = await prisma.matchEvent.findFirst({ where: { matchId: match.id } });
    const expected = describeActionContext(
      createInitialState({
        playerCount: 3,
        difficulty: "balanced",
        seed: 7,
        humanName: nickname,
      }),
    );
    expect(expected).not.toBeNull();
    expect(stored?.round).toBe(expected!.round);
    expect(stored?.phaseType).toBe(expected!.phaseType);
    expect(stored?.activeRole).toBe(expected!.activeRole);
    expect(stored?.actorSeatIndex).toBe(expected!.actorSeatIndex);
    expect(stored?.actorSeatIndex).not.toBe(4);
    expect(stored?.actorUserId).toBeNull();
  });

  it("finishes from the engine replay, not a client score, and does not double-count stats", async () => {
    const nickname = "__it__finish";
    const agent = await guestAgent(nickname);
    const match = await createGuestMatch(agent, { nickname, seed: 2024 });
    const recorded = await recordSoloActions({ seed: 2024, humanName: nickname });
    await postEventChunks(agent, match.id, recorded.events, match.playToken);

    const user = await prisma.user.create({
      data: { displayName: nickname, email: "finish@test.invalid" },
    });
    await prisma.matchParticipant.updateMany({
      where: { matchId: match.id, isHuman: true },
      data: { userId: user.id },
    });

    const incomplete = await guestAgent("__it__early");
    const early = await createGuestMatch(incomplete, { nickname: "__it__early", seed: 3 });
    const earlyFinish = await incomplete.post(`/api/matches/${early.id}/finish`).expect(400);
    expect(earlyFinish.body.error).toMatch(/沒有可重放|尚未結束/);

    const [first, second] = await Promise.all([
      agent.post(`/api/matches/${match.id}/finish`),
      agent.post(`/api/matches/${match.id}/finish`),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.verified).toBe(true);
    expect(first.body.scores.map((s: { total: number }) => s.total)).toEqual(recorded.scores.map((s) => s.total));
    expect(first.body.scores.map((s: { goodsAndGold: number }) => s.goodsAndGold)).toEqual(
      recorded.scores.map((s) => s.goodsAndGold),
    );

    const human = await prisma.matchParticipant.findFirst({ where: { matchId: match.id, isHuman: true } });
    expect(human?.goodsAndGold).toBe(recorded.scores.find((s) => s.playerId === "p0")?.goodsAndGold);

    const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
    expect(stats?.gamesPlayed).toBe(1);
    expect(stats?.bestScore).toBe(recorded.scores.find((s) => s.playerId === "p0")?.total);
  }, 20_000);

  it("backfills verified stats when a guest account is claimed", async () => {
    const nickname = "__it__claim";
    const agent = await guestAgent(nickname);
    const me = await agent.get("/api/auth/me").expect(200);
    const guestId = me.body.guest.id as string;
    const match = await createGuestMatch(agent, { nickname, seed: 2024 });
    const recorded = await recordSoloActions({ seed: 2024, humanName: nickname });
    await postEventChunks(agent, match.id, recorded.events, match.playToken);
    const finished = await agent.post(`/api/matches/${match.id}/finish`).expect(200);
    expect(finished.body.verified).toBe(true);

    const user = await findOrCreateUser(
      prisma,
      {
        provider: "google",
        providerAccountId: "claim-google-1",
        email: "claim@test.invalid",
        emailVerified: true,
        displayName: nickname,
        avatarUrl: null,
      },
      guestId,
    );

    const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
    const humanTotal = recorded.scores.find((s) => s.playerId === "p0")?.total ?? 0;
    expect(stats?.gamesPlayed).toBe(1);
    expect(stats?.totalScore).toBe(humanTotal);
    expect(stats?.bestScore).toBe(humanTotal);
  }, 20_000);

  it("hides the seed off solo and withholds saves that still need consent", async () => {
    const agent = await guestAgent("__it__public");
    const match = await createGuestMatch(agent, { nickname: "__it__public", seed: 11 });
    expect(match.seed).toBe(11);
    expect(match.playToken).toBeTruthy();

    await agent
      .put(`/api/matches/${match.id}/save`)
      .send({ state: { round: 1 }, schemaVersion: "1.0" })
      .expect(200);
    const soloSave = await agent.get(`/api/matches/${match.id}/save`).expect(200);
    expect(soloSave.body.consentRequired).toBe(false);
    expect(soloSave.body.state).toEqual({ round: 1 });

    await prisma.match.update({ where: { id: match.id }, data: { mode: "online" } });
    const listed = await agent.get(`/api/matches/${match.id}`).expect(200);
    expect(listed.body.seed).toBeNull();
    expect(listed.body.playToken).toBeUndefined();

    const writeBlocked = await agent
      .put(`/api/matches/${match.id}/save`)
      .send({ state: { round: 2 }, schemaVersion: "1.0" })
      .expect(403);
    expect(writeBlocked.body.code).toBe("SAVE_CONSENT_REQUIRED");

    const blocked = await agent.get(`/api/matches/${match.id}/save`).expect(403);
    expect(blocked.body.code).toBe("SAVE_CONSENT_REQUIRED");
    expect(blocked.body.error).toMatch(/同意/);
  });

  it("writes an online save only after every human seat consents", async () => {
    const host = await guestAgent("__it__host");
    const guest = await guestAgent("__it__guest");
    const hostGuestId = (await host.get("/api/auth/me").expect(200)).body.guest.id as string;
    const guestGuestId = (await guest.get("/api/auth/me").expect(200)).body.guest.id as string;
    const match = await prisma.match.create({
      data: {
        mode: "online",
        playerCount: 3,
        difficulty: "balanced",
        seed: 31,
        humanName: "__it__host",
        participants: {
          create: [
            { seatIndex: 0, nickname: "__it__host", guestId: hostGuestId, isHuman: true, isAi: false },
            { seatIndex: 1, nickname: "__it__guest", guestId: guestGuestId, isHuman: true, isAi: false },
            { seatIndex: 2, nickname: "AI 2", isHuman: false, isAi: true },
          ],
        },
      },
    });

    const outsider = await guestAgent("__it__outsider");
    await outsider.post(`/api/matches/${match.id}/save-consent`).expect(403);

    const start = createInitialState({
      playerCount: 3,
      difficulty: "balanced",
      seed: 31,
      humanName: "__it__host",
      seatNames: ["__it__host", "__it__guest", "AI 2"],
    });
    const meta = describeActionContext(start);
    expect(meta).not.toBeNull();
    const action = getLegalActions(start)[0];
    if (!action) throw new Error("no legal opening action");
    await prisma.matchEvent.create({
      data: {
        matchId: match.id,
        seq: 1,
        round: meta!.round,
        phaseType: meta!.phaseType,
        activeRole: meta!.activeRole,
        actorSeatIndex: meta!.actorSeatIndex,
        action: action as Prisma.InputJsonValue,
      },
    });
    const expectedState = JSON.parse(JSON.stringify(applyAction(start, action)));

    const first = await host.post(`/api/matches/${match.id}/save-consent`).expect(200);
    expect(first.body).toMatchObject({ seatIndex: 0, consented: 1, required: 2, complete: false });
    expect(await prisma.matchSave.findUnique({ where: { matchId: match.id } })).toBeNull();

    const blocked = await guest.get(`/api/matches/${match.id}/save`).expect(403);
    expect(blocked.body.code).toBe("SAVE_CONSENT_REQUIRED");

    await host.post(`/api/matches/${match.id}/save-consent`).expect(200);
    expect(await prisma.saveConsent.count({ where: { matchId: match.id } })).toBe(1);

    const second = await guest.post(`/api/matches/${match.id}/save-consent`).expect(200);
    expect(second.body).toMatchObject({ seatIndex: 1, consented: 2, required: 2, complete: true });

    const save = await prisma.matchSave.findUnique({ where: { matchId: match.id } });
    expect(save?.consentRequired).toBe(true);
    expect(save?.schemaVersion).toBe("1.0");
    expect(save?.stateJson).toEqual(expectedState);

    const readable = await guest.get(`/api/matches/${match.id}/save`).expect(200);
    expect(readable.body.consentRequired).toBe(true);
    expect(readable.body.state).toEqual(expectedState);
  });
});

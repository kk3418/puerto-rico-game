import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import {
  createGuestMatch,
  guestAgent,
  prepareIntegrationDb,
  resetIntegrationDb,
  testApp,
} from "../test/harness";
import { LOBBY_AWAY_GRACE_MS, LOBBY_STALE_MS } from "./presence";

const ready = await prepareIntegrationDb();

describe.skipIf(!ready)("rooms API", () => {
  afterEach(async () => {
    await resetIntegrationDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("requires a session and creates a lobby room listed until it fills", async () => {
    await testApp().post("/api/rooms").send({ nickname: "__it__anon", playerCount: 3 }).expect(401);

    const host = await guestAgent("__it__host");
    const created = await host.post("/api/rooms").send({ nickname: "__it__host", playerCount: 3 }).expect(201);
    expect(created.body.status).toBe("lobby");
    expect(created.body.joinCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(created.body.hostSeatIndex).toBe(0);
    expect(created.body.hostNickname).toBe("__it__host");
    expect(created.body.seatsTaken).toBe(1);
    expect(created.body.seats).toHaveLength(1);
    expect(created.body.seats[0].seatIndex).toBe(0);
    expect(created.body.seats[0].nickname).toBe("__it__host");

    const second = await host.post("/api/rooms").send({ nickname: "__it__host", playerCount: 4 }).expect(409);
    expect(second.body.code).toBe("ROOM_ALREADY_IN_MATCH");

    await createGuestMatch(host, { nickname: "__it__host", seed: 5 });

    const list = await host.get("/api/rooms").expect(200);
    expect(list.body.rooms).toHaveLength(1);
    const item = list.body.rooms[0];
    expect(item.id).toBe(created.body.id);
    expect(item.joinCode).toBe(created.body.joinCode);
    expect(item.playerCount).toBe(3);
    expect(item.hostNickname).toBe("__it__host");
    expect(item.seatsTaken).toBe(1);
  });

  it("joins by code or id, rejects duplicate identities, and starts only after every seat acknowledges", async () => {
    const host = await guestAgent("__it__h2");
    const created = await host.post("/api/rooms").send({ nickname: "__it__h2", playerCount: 3 }).expect(201);

    const missing = await guestAgent("__it__nobody");
    const notFound = await missing
      .post("/api/rooms/join")
      .send({ nickname: "__it__nobody", joinCode: "ZZZZZZ" })
      .expect(404);
    expect(notFound.body.code).toBe("ROOM_NOT_FOUND");

    const dup = await host
      .post("/api/rooms/join")
      .send({ nickname: "__it__h2", joinCode: created.body.joinCode })
      .expect(409);
    expect(dup.body.code).toBe("ROOM_ALREADY_IN_MATCH");

    const g1 = await guestAgent("__it__g1");
    const joined = await g1
      .post("/api/rooms/join")
      .send({ nickname: "__it__g1", joinCode: created.body.joinCode.toLowerCase() })
      .expect(200);
    expect(joined.body.status).toBe("lobby");
    expect(joined.body.seatsTaken).toBe(2);
    expect(joined.body.seats.map((s: { seatIndex: number }) => s.seatIndex)).toEqual([0, 1]);
    expect(joined.body.state).toBeUndefined();

    const elsewhere = await g1.post("/api/rooms").send({ nickname: "__it__g1", playerCount: 5 }).expect(409);
    expect(elsewhere.body.code).toBe("ROOM_ALREADY_IN_MATCH");

    const g2 = await guestAgent("__it__g2");
    const filled = await g2
      .post("/api/rooms/join")
      .send({ nickname: "__it__g2", roomId: created.body.id })
      .expect(200);
    expect(filled.body.status).toBe("lobby");
    expect(filled.body.seatsTaken).toBe(3);
    expect(filled.body.state).toBeUndefined();

    const hidden = await host.get("/api/rooms").expect(200);
    expect(hidden.body.rooms.find((item: { id: string }) => item.id === created.body.id)).toBeUndefined();

    const ignored = await host.get(`/api/matches/${created.body.id}?ready=1`).expect(200);
    expect(ignored.body.status).toBe("lobby");

    const hostReady = await host.post(`/api/rooms/${created.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(hostReady.body.status).toBe("lobby");
    const g1Ready = await g1.post(`/api/rooms/${created.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(g1Ready.body.status).toBe("lobby");
    const g2Ready = await g2.post(`/api/rooms/${created.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(g2Ready.body.status).toBe("playing");

    const live = await host.get(`/api/matches/${created.body.id}/state`).expect(200);
    expect(live.body.state.players.map((p: { name: string }) => p.name)).toEqual([
      "__it__h2",
      "__it__g1",
      "__it__g2",
    ]);
    expect(live.body.state.players.every((p: { isHuman: boolean }) => p.isHuman)).toBe(true);
    expect(live.body.state.gameOver).toBe(false);
    expect(live.body.state.plantationDeck).toEqual([]);
    expect(live.body.state.plantationDeckCount).toBeGreaterThan(0);
    expect(live.body.state.plantationDiscard).toEqual([]);
    expect("rng" in live.body.state).toBe(false);

    const stored = await prisma.match.findUnique({ where: { id: created.body.id } });
    expect(stored?.status).toBe("playing");

    const list = await host.get("/api/rooms").expect(200);
    expect(list.body.rooms).toHaveLength(0);

    const late = await guestAgent("__it__late");
    const tooLate = await late
      .post("/api/rooms/join")
      .send({ nickname: "__it__late", joinCode: created.body.joinCode })
      .expect(409);
    expect(tooLate.body.code).toBe("ROOM_NOT_LOBBY");

    const leaveBlocked = await host.post(`/api/rooms/${created.body.id}/leave`).expect(409);
    expect(leaveBlocked.body.code).toBe("ROOM_NOT_LOBBY");
    const cancelBlocked = await host.post(`/api/rooms/${created.body.id}/cancel`).expect(409);
    expect(cancelBlocked.body.code).toBe("ROOM_NOT_LOBBY");

    await prisma.match.update({ where: { id: created.body.id }, data: { status: "lobby" } });
    const full = await late
      .post("/api/rooms/join")
      .send({ nickname: "__it__late", joinCode: created.body.joinCode })
      .expect(409);
    expect(full.body.code).toBe("ROOM_FULL");
  });

  it("leaves seats, reassigns the host to the lowest remaining seat, and deletes empty rooms", async () => {
    const host = await guestAgent("__it__lh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__lh", playerCount: 4 }).expect(201);
    const g1 = await guestAgent("__it__l1");
    const g2 = await guestAgent("__it__l2");
    await g1.post("/api/rooms/join").send({ nickname: "__it__l1", joinCode: room.body.joinCode }).expect(200);
    await g2.post("/api/rooms/join").send({ nickname: "__it__l2", roomId: room.body.id }).expect(200);

    const stranger = await guestAgent("__it__ls");
    const notJoined = await stranger.post(`/api/rooms/${room.body.id}/leave`).expect(409);
    expect(notJoined.body.code).toBe("ROOM_NOT_JOINED");

    const afterHost = await host.post(`/api/rooms/${room.body.id}/leave`).expect(200);
    expect(afterHost.body.room.hostSeatIndex).toBe(1);
    expect(afterHost.body.room.hostNickname).toBe("__it__l1");
    expect(afterHost.body.room.seatsTaken).toBe(2);

    const matchView = await g1.get(`/api/matches/${room.body.id}`).expect(200);
    expect(matchView.body.mode).toBe("online");
    expect(matchView.body.status).toBe("lobby");
    expect(matchView.body.hostSeatIndex).toBe(1);
    expect(matchView.body.joinCode).toBe(room.body.joinCode);

    const rejoined = await host
      .post("/api/rooms/join")
      .send({ nickname: "__it__lh", joinCode: room.body.joinCode })
      .expect(200);
    expect(rejoined.body.seats.map((s: { seatIndex: number }) => s.seatIndex)).toEqual([0, 1, 2]);
    expect(rejoined.body.seats[0].nickname).toBe("__it__lh");

    const afterG1 = await g1.post(`/api/rooms/${room.body.id}/leave`).expect(200);
    expect(afterG1.body.room.hostSeatIndex).toBe(0);
    expect(afterG1.body.room.hostNickname).toBe("__it__lh");

    await g2.post(`/api/rooms/${room.body.id}/leave`).expect(200);
    const emptied = await host.post(`/api/rooms/${room.body.id}/leave`).expect(200);
    expect(emptied.body.room).toBeNull();
    expect(await prisma.match.findUnique({ where: { id: room.body.id } })).toBeNull();
  });

  it("lets only the host cancel a lobby room", async () => {
    const host = await guestAgent("__it__ch");
    const room = await host.post("/api/rooms").send({ nickname: "__it__ch", playerCount: 3 }).expect(201);
    const g1 = await guestAgent("__it__c1");
    await g1.post("/api/rooms/join").send({ nickname: "__it__c1", joinCode: room.body.joinCode }).expect(200);

    const forbidden = await g1.post(`/api/rooms/${room.body.id}/cancel`).expect(403);
    expect(forbidden.body.code).toBe("ROOM_NOT_HOST");

    const cancelled = await host.post(`/api/rooms/${room.body.id}/cancel`).expect(200);
    expect(cancelled.body.room).toBeNull();
    expect(await prisma.match.findUnique({ where: { id: room.body.id } })).toBeNull();

    const list = await host.get("/api/rooms").expect(200);
    expect(list.body.rooms).toHaveLength(0);

    const rejoin = await g1
      .post("/api/rooms/join")
      .send({ nickname: "__it__c1", joinCode: room.body.joinCode })
      .expect(404);
    expect(rejoin.body.code).toBe("ROOM_NOT_FOUND");
  });

  it("does not auto-start when a seated player has left the page", async () => {
    const host = await guestAgent("__it__ah");
    const room = await host.post("/api/rooms").send({ nickname: "__it__ah", playerCount: 3 }).expect(201);
    const gone = await guestAgent("__it__ag");
    await gone.post("/api/rooms/join").send({ nickname: "__it__ag", joinCode: room.body.joinCode }).expect(200);
    await gone.post(`/api/rooms/${room.body.id}/leave`).expect(200);

    const third = await guestAgent("__it__at");
    const joined = await third
      .post("/api/rooms/join")
      .send({ nickname: "__it__at", joinCode: room.body.joinCode })
      .expect(200);
    expect(joined.body.status).toBe("lobby");
    expect(joined.body.seats.map((s: { nickname: string }) => s.nickname)).toEqual(["__it__ah", "__it__at"]);

    const lobby = await host.get(`/api/matches/${room.body.id}`).expect(200);
    expect(lobby.body.status).toBe("lobby");
    expect(lobby.body.participants.map((p: { nickname: string }) => p.nickname)).toEqual(["__it__ah", "__it__at"]);
  });

  it("drops a lobby seat that stopped checking in before the room can fill", async () => {
    const host = await guestAgent("__it__sh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__sh", playerCount: 3 }).expect(201);
    const gone = await guestAgent("__it__sg");
    await gone.post("/api/rooms/join").send({ nickname: "__it__sg", joinCode: room.body.joinCode }).expect(200);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id, nickname: "__it__sg" },
      data: { lobbySeenAt: new Date(0) },
    });

    const third = await guestAgent("__it__st");
    const joined = await third
      .post("/api/rooms/join")
      .send({ nickname: "__it__st", roomId: room.body.id })
      .expect(200);
    expect(joined.body.status).toBe("lobby");
    expect(joined.body.seats.map((s: { nickname: string }) => s.nickname)).toEqual(["__it__sh", "__it__st"]);

    const listed = await host.get("/api/rooms").expect(200);
    expect(listed.body.rooms.find((item: { id: string }) => item.id === room.body.id)?.seatsTaken).toBe(2);
  });

  it("does not start a full room when a seat leaves before acknowledging", async () => {
    const host = await guestAgent("__it__rh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__rh", playerCount: 3 }).expect(201);
    const gone = await guestAgent("__it__rg");
    const stay = await guestAgent("__it__rs");
    await gone.post("/api/rooms/join").send({ nickname: "__it__rg", joinCode: room.body.joinCode }).expect(200);
    const filled = await stay
      .post("/api/rooms/join")
      .send({ nickname: "__it__rs", joinCode: room.body.joinCode })
      .expect(200);
    expect(filled.body.status).toBe("lobby");

    const early = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(early.body.status).toBe("lobby");
    await gone.post(`/api/rooms/${room.body.id}/leave`).expect(200);

    const hostReady = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(hostReady.body.status).toBe("lobby");
    const stayReady = await stay.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(stayReady.body.status).toBe("lobby");
    expect(stayReady.body.seats.map((p: { nickname: string }) => p.nickname)).toEqual(["__it__rh", "__it__rs"]);

    const seats = await prisma.matchParticipant.findMany({ where: { matchId: room.body.id } });
    expect(seats.every((seat) => seat.lobbyReadyAt === null)).toBe(true);
  });

  it("does not start when a full-room seat stopped checking in", async () => {
    const host = await guestAgent("__it__fh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__fh", playerCount: 3 }).expect(201);
    const gone = await guestAgent("__it__fg");
    const stay = await guestAgent("__it__fs");
    await gone.post("/api/rooms/join").send({ nickname: "__it__fg", joinCode: room.body.joinCode }).expect(200);
    await stay.post("/api/rooms/join").send({ nickname: "__it__fs", joinCode: room.body.joinCode }).expect(200);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id, nickname: "__it__fg" },
      data: { lobbySeenAt: new Date(0) },
    });

    const hostReady = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(hostReady.body.status).toBe("lobby");
    expect(hostReady.body.seats.map((p: { nickname: string }) => p.nickname)).toEqual(["__it__fh", "__it__fs"]);

    const stayReady = await stay.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(stayReady.body.status).toBe("lobby");
    expect(stayReady.body.seats.map((p: { nickname: string }) => p.nickname)).toEqual(["__it__fh", "__it__fs"]);
  });

  it("hides a quiet lobby without deleting it, and a seated heartbeat brings it back", async () => {
    const host = await guestAgent("__it__kh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__kh", playerCount: 3 }).expect(201);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id },
      data: { lobbySeenAt: new Date(0) },
    });

    const stranger = await guestAgent("__it__ks");
    const list = await stranger.get("/api/rooms").expect(200);
    expect(list.body.rooms.find((item: { id: string }) => item.id === room.body.id)).toBeUndefined();
    expect(await prisma.match.findUnique({ where: { id: room.body.id } })).not.toBeNull();

    const denied = await stranger.get(`/api/matches/${room.body.id}`).expect(403);
    expect(denied.body.code).toBe("MATCH_FORBIDDEN");
    const pulse = await stranger.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(403);
    expect(pulse.body.code).toBe("MATCH_FORBIDDEN");

    const seats = await prisma.matchParticipant.findMany({ where: { matchId: room.body.id } });
    expect(seats).toHaveLength(1);
    expect(seats[0]?.nickname).toBe("__it__kh");

    const back = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: false }).expect(200);
    expect(back.body.status).toBe("lobby");
    expect(back.body.seatsTaken).toBe(1);

    const listed = await stranger.get("/api/rooms").expect(200);
    expect(listed.body.rooms.find((item: { id: string }) => item.id === room.body.id)?.seatsTaken).toBe(1);
  });

  it("joins a lobby whose seats have all gone quiet without deleting the room", async () => {
    const host = await guestAgent("__it__qh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__qh", playerCount: 3 }).expect(201);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id },
      data: { lobbySeenAt: new Date(0) },
    });

    const guest = await guestAgent("__it__qg");
    const joined = await guest
      .post("/api/rooms/join")
      .send({ nickname: "__it__qg", joinCode: room.body.joinCode })
      .expect(200);
    expect(joined.body.status).toBe("lobby");
    expect(joined.body.hostSeatIndex).toBe(0);
    expect(joined.body.seats.map((s: { nickname: string }) => s.nickname)).toEqual(["__it__qg"]);
    expect(await prisma.match.findUnique({ where: { id: room.body.id } })).not.toBeNull();
  });

  it("keeps the other seats when every seat went quiet together", async () => {
    const host = await guestAgent("__it__oh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__oh", playerCount: 3 }).expect(201);
    const guest = await guestAgent("__it__og");
    await guest.post("/api/rooms/join").send({ nickname: "__it__og", joinCode: room.body.joinCode }).expect(200);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id },
      data: { lobbySeenAt: new Date(0) },
    });

    const beat = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(beat.body.status).toBe("lobby");
    expect(beat.body.seats.map((s: { nickname: string }) => s.nickname).sort()).toEqual(["__it__og", "__it__oh"]);
  });

  it("does not start until every acknowledgement is recent", async () => {
    const host = await guestAgent("__it__yh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__yh", playerCount: 2 }).expect(201);
    const guest = await guestAgent("__it__yg");
    await guest.post("/api/rooms/join").send({ nickname: "__it__yg", joinCode: room.body.joinCode }).expect(200);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id, nickname: "__it__yg" },
      data: { lobbyReadyAt: new Date(Date.now() - 60_000), lobbySeenAt: new Date() },
    });

    const hostReady = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(hostReady.body.status).toBe("lobby");
    const guestReady = await guest.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(guestReady.body.status).toBe("playing");
  });

  it("lists a live room even when 50 older rooms have gone stale", async () => {
    const longAgo = new Date(Date.now() - 60 * 60_000);
    for (let i = 0; i < 50; i++) {
      await prisma.match.create({
        data: {
          mode: "online",
          status: "lobby",
          playerCount: 3,
          difficulty: "balanced",
          seed: i,
          humanName: `__it__old${i}`,
          startedAt: longAgo,
          participants: {
            create: [
              {
                seatIndex: 0,
                nickname: `__it__old${i}`,
                guestId: `__it__old${i}`,
                isHuman: true,
                isAi: false,
                lobbySeenAt: new Date(0),
              },
            ],
          },
        },
      });
    }

    const host = await guestAgent("__it__live");
    const room = await host.post("/api/rooms").send({ nickname: "__it__live", playerCount: 3 }).expect(201);
    const list = await host.get("/api/rooms").expect(200);
    expect(list.body.rooms.map((item: { id: string }) => item.id)).toEqual([room.body.id]);
    expect(await prisma.match.count({ where: { mode: "online", status: "lobby" } })).toBe(51);
  });

  it("releases this identity's own stale lobby seat when it creates or joins another room", async () => {
    const host = await guestAgent("__it__eh");
    const abandoned = await host.post("/api/rooms").send({ nickname: "__it__eh", playerCount: 3 }).expect(201);
    await prisma.matchParticipant.updateMany({
      where: { matchId: abandoned.body.id },
      data: { lobbySeenAt: new Date(0) },
    });

    const created = await host.post("/api/rooms").send({ nickname: "__it__eh", playerCount: 3 }).expect(201);
    expect(await prisma.match.findUnique({ where: { id: abandoned.body.id } })).toBeNull();
    const blocked = await host.post("/api/rooms").send({ nickname: "__it__eh", playerCount: 3 }).expect(409);
    expect(blocked.body.code).toBe("ROOM_ALREADY_IN_MATCH");

    const friend = await guestAgent("__it__ef");
    await friend.post("/api/rooms/join").send({ nickname: "__it__ef", joinCode: created.body.joinCode }).expect(200);
    await prisma.matchParticipant.updateMany({
      where: { matchId: created.body.id, nickname: "__it__eh" },
      data: { lobbySeenAt: new Date(0) },
    });

    const other = await guestAgent("__it__eo");
    const target = await other.post("/api/rooms").send({ nickname: "__it__eo", playerCount: 3 }).expect(201);
    const joined = await host
      .post("/api/rooms/join")
      .send({ nickname: "__it__eh", joinCode: target.body.joinCode })
      .expect(200);
    expect(joined.body.seats.map((s: { nickname: string }) => s.nickname)).toEqual(["__it__eo", "__it__eh"]);

    const left = await prisma.match.findUnique({
      where: { id: created.body.id },
      include: { participants: true },
    });
    expect(left?.status).toBe("lobby");
    expect(left?.hostSeatIndex).toBe(1);
    expect(left?.participants.map((p) => p.nickname)).toEqual(["__it__ef"]);
  });

  it("lets two players join each other's rooms at once while each holds a stale seat in the other", async () => {
    const x = await guestAgent("__it__dx");
    const y = await guestAgent("__it__dy");
    const roomX = await x.post("/api/rooms").send({ nickname: "__it__dx", playerCount: 3 }).expect(201);
    const roomY = await y.post("/api/rooms").send({ nickname: "__it__dy", playerCount: 3 }).expect(201);
    const fx = await guestAgent("__it__dfx");
    const fy = await guestAgent("__it__dfy");
    await fx.post("/api/rooms/join").send({ nickname: "__it__dfx", roomId: roomX.body.id }).expect(200);
    await fy.post("/api/rooms/join").send({ nickname: "__it__dfy", roomId: roomY.body.id }).expect(200);
    await prisma.matchParticipant.updateMany({
      where: { nickname: { in: ["__it__dx", "__it__dy"] } },
      data: { lobbySeenAt: new Date(0) },
    });

    let xSeatRoom: string = roomX.body.id;
    let ySeatRoom: string = roomY.body.id;
    for (let round = 0; round < 5; round++) {
      const [xJoin, yJoin] = await Promise.all([
        x.post("/api/rooms/join").send({ nickname: "__it__dx", roomId: ySeatRoom }),
        y.post("/api/rooms/join").send({ nickname: "__it__dy", roomId: xSeatRoom }),
      ]);
      expect([xJoin.status, yJoin.status]).toEqual([200, 200]);
      [xSeatRoom, ySeatRoom] = [ySeatRoom, xSeatRoom];
      await prisma.matchParticipant.updateMany({
        where: { nickname: { in: ["__it__dx", "__it__dy"] } },
        data: { lobbySeenAt: new Date(0) },
      });
    }
    const seats = await prisma.matchParticipant.findMany({ orderBy: { nickname: "asc" } });
    expect(seats.map((s) => [s.nickname, s.matchId])).toEqual([
      ["__it__dfx", roomX.body.id],
      ["__it__dfy", roomY.body.id],
      ["__it__dx", xSeatRoom],
      ["__it__dy", ySeatRoom],
    ]);
  });

  it("rejoins its own stale room by code without deleting it", async () => {
    const host = await guestAgent("__it__rj");
    const room = await host.post("/api/rooms").send({ nickname: "__it__rj", playerCount: 3 }).expect(201);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id },
      data: { lobbySeenAt: new Date(0) },
    });

    const back = await host
      .post("/api/rooms/join")
      .send({ nickname: "__it__rj", joinCode: room.body.joinCode })
      .expect(200);
    expect(back.body.id).toBe(room.body.id);
    expect(back.body.hostSeatIndex).toBe(0);
    expect(back.body.seats.map((s: { nickname: string }) => s.nickname)).toEqual(["__it__rj"]);
  });

  it("lets a hidden page's seat lapse after a short grace unless a heartbeat comes back", async () => {
    const host = await guestAgent("__it__wh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__wh", playerCount: 3 }).expect(201);
    const guest = await guestAgent("__it__wg");
    await guest.post("/api/rooms/join").send({ nickname: "__it__wg", joinCode: room.body.joinCode }).expect(200);
    const guestSeat = { matchId: room.body.id, nickname: "__it__wg" };

    const before = Date.now();
    await guest.post(`/api/rooms/${room.body.id}/away`).expect(204);
    const after = Date.now();
    const away = await prisma.matchParticipant.findFirstOrThrow({ where: guestSeat });
    expect(away.lobbySeenAt.getTime()).toBeGreaterThanOrEqual(before - LOBBY_STALE_MS + LOBBY_AWAY_GRACE_MS);
    expect(away.lobbySeenAt.getTime()).toBeLessThanOrEqual(after - LOBBY_STALE_MS + LOBBY_AWAY_GRACE_MS);

    const kept = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: false }).expect(200);
    expect(kept.body.seatsTaken).toBe(2);

    await guest.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: false }).expect(200);
    const returned = await prisma.matchParticipant.findFirstOrThrow({ where: guestSeat });
    expect(Date.now() - returned.lobbySeenAt.getTime()).toBeLessThan(5_000);

    await guest.post(`/api/rooms/${room.body.id}/away`).expect(204);
    const hidden = await prisma.matchParticipant.findFirstOrThrow({ where: guestSeat });
    await prisma.matchParticipant.updateMany({
      where: guestSeat,
      data: { lobbySeenAt: new Date(hidden.lobbySeenAt.getTime() - LOBBY_AWAY_GRACE_MS - 1) },
    });
    const dropped = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: false }).expect(200);
    expect(dropped.body.seats.map((s: { nickname: string }) => s.nickname)).toEqual(["__it__wh"]);
  });

  it("does not move a seat's last-seen time forward when its page is hidden", async () => {
    const host = await guestAgent("__it__vh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__vh", playerCount: 3 }).expect(201);
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.body.id },
      data: { lobbySeenAt: new Date(0) },
    });

    await host.post(`/api/rooms/${room.body.id}/away`).expect(204);
    const seat = await prisma.matchParticipant.findFirstOrThrow({ where: { matchId: room.body.id } });
    expect(seat.lobbySeenAt.getTime()).toBe(0);
  });

  it("does not start a full room while a seat's page is hidden, and ignores away from strangers or after start", async () => {
    const host = await guestAgent("__it__xh");
    const room = await host.post("/api/rooms").send({ nickname: "__it__xh", playerCount: 2 }).expect(201);
    const guest = await guestAgent("__it__xg");
    await guest.post("/api/rooms/join").send({ nickname: "__it__xg", joinCode: room.body.joinCode }).expect(200);

    const stranger = await guestAgent("__it__xs");
    const denied = await stranger.post(`/api/rooms/${room.body.id}/away`).expect(403);
    expect(denied.body.code).toBe("MATCH_FORBIDDEN");
    const missing = await stranger.post("/api/rooms/no-such-room/away").expect(404);
    expect(missing.body.code).toBe("ROOM_NOT_FOUND");

    const guestReady = await guest.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(guestReady.body.status).toBe("lobby");
    await guest.post(`/api/rooms/${room.body.id}/away`).expect(204);
    const away = await prisma.matchParticipant.findFirstOrThrow({
      where: { matchId: room.body.id, nickname: "__it__xg" },
    });
    expect(away.lobbyReadyAt).toBeNull();

    const hostReady = await host.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(hostReady.body.status).toBe("lobby");
    const guestBack = await guest.post(`/api/rooms/${room.body.id}/heartbeat`).send({ ready: true }).expect(200);
    expect(guestBack.body.status).toBe("playing");

    await guest.post(`/api/rooms/${room.body.id}/away`).expect(204);
    const started = await prisma.match.findUnique({
      where: { id: room.body.id },
      include: { participants: true },
    });
    expect(started?.status).toBe("playing");
    expect(started?.participants).toHaveLength(2);
  });
});

import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { e2eDatabaseUrl } from "./database-url";

const heartbeatRequest = /\/api\/rooms\/[^/]+\/heartbeat$/;

let prisma: PrismaClient;

test.beforeAll(() => {
  prisma = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl() } } });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.beforeEach(async () => {
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
});

async function openSetup(context: BrowserContext, nickname: string): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("i18nextLng", "en");
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Nickname" }).fill(nickname);
  await expect(page.getByRole("button", { name: "Create room" })).toBeEnabled();
  return page;
}

async function withholdReady(page: Page): Promise<void> {
  await page.route(heartbeatRequest, async (route) => {
    const response = await route.fetch({ postData: JSON.stringify({ ready: false }) });
    await route.fulfill({ response });
  });
}

async function createLobby(page: Page, playerCount: 2 | 3 | 4 | 5 = 2): Promise<{ id: string }> {
  if (playerCount !== 2) {
    await page.getByRole("radio", { name: `${playerCount} players` }).check();
  }
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/rooms" &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Create room" }).click();
  const room = (await (await created).json()) as { id: string };
  await expect(page.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  return room;
}

async function joinListedRoom(page: Page, hostName: string): Promise<void> {
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("listitem").filter({ hasText: hostName }).getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("heading", { name: "Online lobby" })).toBeVisible();
}

/** Answer later heartbeats from the last real payload, so the seat's timestamp stays put. */
async function holdHeartbeats(page: Page): Promise<() => Promise<void>> {
  let body = "";
  let captured = false;
  let ready = false;
  let released = false;
  await page.route(heartbeatRequest, async (route) => {
    if (captured) {
      await route.fulfill({ status: 200, contentType: "application/json", body });
      return;
    }
    captured = true;
    const response = await route.fetch();
    body = await response.text();
    ready = true;
    await route.fulfill({ response });
  });
  await expect.poll(() => ready).toBe(true);
  return async () => {
    if (released) return;
    released = true;
    await page.unroute(heartbeatRequest);
  };
}

test("a full lobby stays open until both seats acknowledge it", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  await withholdReady(host);
  await withholdReady(guest);

  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  await guest.getByRole("button", { name: "Refresh" }).click();
  await guest.getByRole("listitem").filter({ hasText: "e2e-host" }).getByRole("button", { name: "Join" }).click();

  await expect(host.getByText("2/2 players")).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  await expect(guest.getByText("2/2 players")).toBeVisible();
  await host.waitForTimeout(2500);
  await expect(host.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  await host.unroute(heartbeatRequest);
  await guest.unroute(heartbeatRequest);

  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(host.getByRole("tab", { name: /e2e-host/ })).toBeVisible();
  await expect(host.getByRole("tab", { name: /e2e-guest/ })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test("closing a lobby page keeps the seat until that player goes quiet", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");

  const created = host.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/rooms" &&
      response.status() === 201,
  );
  await host.getByRole("radio", { name: "3 players" }).check();
  await host.getByRole("button", { name: "Create room" }).click();
  const room = (await (await created).json()) as { id: string };
  await expect(host.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  await guest.getByRole("button", { name: "Refresh" }).click();
  await guest.getByRole("listitem").filter({ hasText: "e2e-host" }).getByRole("button", { name: "Join" }).click();
  await expect(guest.getByRole("button", { name: "Leave room" })).toBeVisible();
  await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toBeVisible();

  await guest.close();
  await host.waitForTimeout(2500);
  await expect(host.getByText("2/3 players")).toBeVisible();
  await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toBeVisible();

  await prisma.matchParticipant.updateMany({
    where: { matchId: room.id, nickname: "e2e-guest" },
    data: { lobbySeenAt: new Date(0) },
  });

  await expect(host.getByText("1/3 players")).toBeVisible();
  await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toHaveCount(0);
  await expect(host.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test("a playing match rejects leave and still waits on that seat", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");

  const created = host.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/rooms" &&
      response.status() === 201,
  );
  await host.getByRole("button", { name: "Create room" }).click();
  const room = (await (await created).json()) as { id: string };

  await guest.getByRole("button", { name: "Refresh" }).click();
  await guest.getByRole("listitem").filter({ hasText: "e2e-host" }).getByRole("button", { name: "Join" }).click();

  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();

  const hostActing = host.getByRole("tab", { name: /e2e-host/ }).getByText("Acting", { exact: true });
  const guestActing = host.getByRole("tab", { name: /e2e-guest/ }).getByText("Acting", { exact: true });
  await expect(hostActing.or(guestActing)).toBeVisible();
  const hostIsActor = await hostActing.isVisible();
  const actor = hostIsActor ? host : guest;
  const waiter = hostIsActor ? guest : host;
  const actorContext = hostIsActor ? hostContext : guestContext;
  const actorName = hostIsActor ? "e2e-host" : "e2e-guest";

  await expect(actor.getByText("Waiting for the other players…")).toHaveCount(0);
  await expect(waiter.getByText("Waiting for the other players…")).toBeVisible();
  await expect(waiter.getByRole("button", { name: "Settler", exact: true })).toBeDisabled();

  const leave = await actorContext.request.post(`/api/rooms/${room.id}/leave`);
  expect(leave.status()).toBe(409);
  expect(await leave.json()).toMatchObject({ code: "ROOM_NOT_LOBBY" });

  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();

  await actor.close();

  const actorTab = waiter.getByRole("tab", { name: new RegExp(actorName) });
  await expect(waiter.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(actorTab).toBeVisible();
  await expect(actorTab).toContainText("Acting");
  await expect(waiter.getByText("Waiting for the other players…")).toBeVisible();
  await expect(waiter.getByRole("button", { name: "Settler", exact: true })).toBeDisabled();

  await waiter.waitForTimeout(2500);

  await expect(waiter.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(actorTab).toContainText("Acting");
  await expect(waiter.getByText("Waiting for the other players…")).toBeVisible();
  await expect(waiter.getByRole("button", { name: "Settler", exact: true })).toBeDisabled();

  const live = await waiter.request.get(`/api/matches/${room.id}/state`);
  expect(live.ok()).toBe(true);
  const body = (await live.json()) as {
    state: { phase: { type: string }; chooserIndex: number; players: { name: string }[] };
  };
  expect(body.state.phase.type).toBe("chooseRole");
  expect(body.state.players[body.state.chooserIndex]?.name).toBe(actorName);

  const stored = await prisma.match.findUnique({
    where: { id: room.id },
    include: { participants: true },
  });
  expect(stored?.status).toBe("playing");
  expect(stored?.participants.map((participant) => participant.nickname).sort()).toEqual(["e2e-guest", "e2e-host"]);

  await hostContext.close();
  await guestContext.close();
});

test("a removed lobby player can return to setup", async ({ browser }) => {
  test.setTimeout(45_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  const room = await createLobby(host, 3);
  await joinListedRoom(guest, "e2e-host");
  await expect(guest.getByRole("button", { name: "Leave room" })).toBeVisible();

  const releaseGuest = await holdHeartbeats(guest);
  try {
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.id, nickname: "e2e-guest" },
      data: { lobbySeenAt: new Date(0) },
    });
    await expect(host.getByText("1/3 players")).toBeVisible();
    await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toHaveCount(0);
  } finally {
    await releaseGuest();
  }

  await expect(guest.getByText("You are no longer in this room")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Leave room" })).toHaveCount(0);
  await guest.getByRole("button", { name: "Back" }).click();
  await expect(guest.getByRole("button", { name: "Create room" })).toBeVisible();

  const afterGuest = await prisma.match.findUnique({
    where: { id: room.id },
    include: { participants: true },
  });
  expect(afterGuest?.participants.map((participant) => participant.nickname)).toEqual(["e2e-host"]);

  await joinListedRoom(guest, "e2e-host");
  const releaseHost = await holdHeartbeats(host);
  try {
    await prisma.matchParticipant.updateMany({
      where: { matchId: room.id, nickname: "e2e-host" },
      data: { lobbySeenAt: new Date(0) },
    });
    await expect(guest.getByRole("button", { name: "Cancel room" })).toBeVisible();
    await expect(guest.getByText("1/3 players")).toBeVisible();

    await host.getByRole("button", { name: "Cancel room" }).click();
    await expect(host.getByRole("button", { name: "Create room" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Online lobby" })).toBeVisible();
    await expect(guest.getByText("1/3 players")).toBeVisible();
  } finally {
    await releaseHost();
  }

  const afterHost = await prisma.match.findUnique({
    where: { id: room.id },
    include: { participants: true },
  });
  expect(afterHost?.status).toBe("lobby");
  expect(afterHost?.participants.map((participant) => participant.nickname)).toEqual(["e2e-guest"]);

  await hostContext.close();
  await guestContext.close();
});

test("another lobby tab or a restored page keeps the seat", async ({ browser }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext();
  const first = await openSetup(context, "e2e-host");
  const room = await createLobby(first, 3);

  const second = await context.newPage();
  await second.addInitScript(() => {
    localStorage.setItem("i18nextLng", "en");
  });
  await second.goto("/");
  await expect(second.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Cancel room" })).toBeVisible();

  await first.close();
  await second.waitForTimeout(2500);
  await expect(second.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  await expect(second.getByText("You are no longer in this room")).toHaveCount(0);
  await expect(second.getByRole("button", { name: "Cancel room" })).toBeVisible();
  expect(await prisma.matchParticipant.findFirst({ where: { matchId: room.id, nickname: "e2e-host" } })).not.toBeNull();
  await context.close();

  // Playwright keeps the back-forward cache disabled, so this return is a reload.
  // The seat still has to be here: leaving the page must not drop it.
  const backContext = await browser.newContext();
  const page = await openSetup(backContext, "e2e-back");
  const restoredRoom = await createLobby(page, 3);
  await page.evaluate(() => {
    location.assign("/api/health");
  });
  await page.waitForURL("**/api/health");
  await page.evaluate(() => {
    history.back();
  });
  await expect(page.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel room" })).toBeVisible();
  await expect(page.getByText("You are no longer in this room")).toHaveCount(0);
  expect(
    await prisma.matchParticipant.findFirst({ where: { matchId: restoredRoom.id, nickname: "e2e-back" } }),
  ).not.toBeNull();
  await backContext.close();
});

test("opening the room list keeps a quiet host room", async ({ browser }) => {
  test.setTimeout(45_000);
  const hostContext = await browser.newContext();
  const friendContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const room = await createLobby(host, 3);
  const releaseHost = await holdHeartbeats(host);
  await prisma.matchParticipant.updateMany({
    where: { matchId: room.id },
    data: { lobbySeenAt: new Date(0) },
  });
  const friend = await openSetup(friendContext, "e2e-friend");
  try {
    await expect(friend.getByText("No open rooms right now")).toBeVisible();

    const hidden = await prisma.match.findUnique({
      where: { id: room.id },
      include: { participants: true },
    });
    expect(hidden?.status).toBe("lobby");
    expect(hidden?.participants.map((participant) => participant.nickname)).toEqual(["e2e-host"]);
  } finally {
    await releaseHost();
  }

  await expect
    .poll(async () => {
      const seat = await prisma.matchParticipant.findFirst({
        where: { matchId: room.id, nickname: "e2e-host" },
      });
      return seat != null && Date.now() - seat.lobbySeenAt.getTime() < 10_000;
    })
    .toBe(true);
  await joinListedRoom(friend, "e2e-host");
  await expect(host.getByText("2/3 players")).toBeVisible();
  await expect(friend.getByText("2/3 players")).toBeVisible();

  const joined = await prisma.match.findUnique({
    where: { id: room.id },
    include: { participants: true },
  });
  expect(joined?.participants.map((participant) => participant.nickname).sort()).toEqual(["e2e-friend", "e2e-host"]);

  await hostContext.close();
  await friendContext.close();
});

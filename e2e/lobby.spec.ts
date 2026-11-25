import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { e2eDatabaseUrl } from "./database-url";

const heartbeatRequest = /\/api\/rooms\/[^/]+\/heartbeat$/;
const E2E_ORIGIN = "http://127.0.0.1:5179";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
});

/** Sign a session id the way express-session's `cookie-signature` does. */
function signedSessionCookie(sid: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  const signature = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return `s:${sid}.${signature}`;
}

/**
 * Put a Google account's session in a browser context. The e2e suite cannot
 * complete a real OAuth round-trip, so it seeds the same User + Session rows the
 * Google callback would create.
 */
async function signedInContext(context: BrowserContext, displayName: string): Promise<void> {
  const user = await prisma.user.create({
    data: {
      email: `${displayName}@e2e.test`,
      displayName,
      accounts: {
        create: { provider: "google", providerAccountId: `e2e-${displayName}` },
      },
    },
  });
  const sid = randomUUID();
  const expire = new Date(Date.now() + SESSION_TTL_MS);
  const sess = {
    cookie: {
      path: "/",
      secure: false,
      expires: expire.toISOString(),
      httpOnly: true,
      sameSite: "lax",
      originalMaxAge: SESSION_TTL_MS - 1,
    },
    userId: user.id,
  } as unknown as Prisma.InputJsonValue;
  await prisma.session.create({ data: { sid, sess, expire } });
  await context.addCookies([
    { name: "pr.sid", value: signedSessionCookie(sid), url: E2E_ORIGIN },
  ]);
}

async function openSetupPage(
  context: BrowserContext,
  nickname: string,
  keepLastMatch = true,
): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(
    ({ keep }) => {
      localStorage.setItem("i18nextLng", "en");
      if (!keep) localStorage.removeItem("pr.lastMatchId");
    },
    { keep: keepLastMatch },
  );
  await page.goto("/");
  await page.getByRole("textbox", { name: "Nickname" }).fill(nickname);
  await expect(page.getByRole("button", { name: "Create room" })).toBeEnabled();
  return page;
}

async function openSetup(context: BrowserContext, nickname: string): Promise<Page> {
  await signedInContext(context, nickname);
  return openSetupPage(context, nickname);
}

async function openGuestSetup(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("i18nextLng", "en");
  });
  await page.goto("/");
  await expect(page.getByText("Sign in to play online.")).toBeVisible();
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

/** How long ago the server last saw this seat, or null once it is gone. */
async function seatAge(matchId: string, nickname: string): Promise<number | null> {
  const seat = await prisma.matchParticipant.findFirst({ where: { matchId, nickname } });
  return seat == null ? null : Date.now() - seat.lobbySeenAt.getTime();
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

test("closing a lobby page releases the seat after a short grace", async ({ browser }) => {
  test.setTimeout(45_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  const room = await createLobby(host, 3);

  await joinListedRoom(guest, "e2e-host");
  await expect(guest.getByRole("button", { name: "Leave room" })).toBeVisible();
  await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toBeVisible();

  await guest.close();
  await expect.poll(() => seatAge(room.id, "e2e-guest")).toBeGreaterThan(60_000);
  await expect(host.getByText("2/3 players")).toBeVisible();
  await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toBeVisible();

  await expect(host.getByText("1/3 players")).toBeVisible({ timeout: 20_000 });
  await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toHaveCount(0);
  await expect(host.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test("leaving a two-player match abandons it and frees both seats", async ({ browser }) => {
  test.setTimeout(60_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  const room = await createLobby(host);
  await joinListedRoom(guest, "e2e-host");
  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });

  await host.getByRole("button", { name: "Leave", exact: true }).click();
  const leaveDialog = host.getByRole("dialog", { name: "Leave this match?" });
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole("button", { name: "Leave match" }).click();
  await expect(host.getByRole("button", { name: "Create room" })).toBeVisible();

  const ended = guest.getByRole("dialog", { name: "This match has ended" });
  await expect(ended).toBeVisible();
  await ended.getByRole("button", { name: "Leave" }).click();
  await expect(guest.getByRole("button", { name: "Create room" })).toBeVisible();

  const stored = await prisma.match.findUnique({ where: { id: room.id } });
  expect(stored?.status).toBe("abandoned");

  // The player who left can immediately open another room.
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  await expect(host.getByRole("button", { name: "Cancel room" })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test("a seated host can leave an old lobby and retry creating a room", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const room = await createLobby(host, 3);

  // A second tab with no last-match pointer lands on setup while the host is still seated.
  const setup = await openSetupPage(hostContext, "e2e-host", false);
  await setup.getByRole("button", { name: "Create room" }).click();
  const blocked = setup.getByRole("dialog", { name: "You are still in an online match" });
  await expect(blocked).toBeVisible();
  await blocked.getByRole("button", { name: "Leave old room and continue" }).click();
  await expect(setup.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  expect(await prisma.match.findUnique({ where: { id: room.id } })).toBeNull();

  await hostContext.close();
});

test("a seated guest can leave an old lobby and retry creating a room", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  const room = await createLobby(host, 3);
  await joinListedRoom(guest, "e2e-host");

  const setup = await openSetupPage(guestContext, "e2e-guest", false);
  await setup.getByRole("button", { name: "Create room" }).click();
  const blocked = setup.getByRole("dialog", { name: "You are still in an online match" });
  await expect(blocked).toBeVisible();
  await blocked.getByRole("button", { name: "Leave old room and continue" }).click();
  await expect(setup.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  const old = await prisma.match.findUnique({
    where: { id: room.id },
    include: { participants: true },
  });
  expect(old?.participants.map((participant) => participant.nickname)).toEqual(["e2e-host"]);

  await hostContext.close();
  await guestContext.close();
});

test("a player still in a live match can leave and retry creating a room", async ({ browser }) => {
  test.setTimeout(60_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  const room = await createLobby(host);
  await joinListedRoom(guest, "e2e-host");
  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });

  const setup = await openSetupPage(hostContext, "e2e-host", false);
  await setup.getByRole("button", { name: "Create room" }).click();
  const blocked = setup.getByRole("dialog", { name: "You are still in an online match" });
  await expect(blocked).toBeVisible();
  await expect(blocked.getByText("still in a match that is in progress")).toBeVisible();
  await blocked.getByRole("button", { name: "Leave match and continue" }).click();
  await expect(setup.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  const old = await prisma.match.findUnique({ where: { id: room.id } });
  expect(old?.status).toBe("abandoned");

  await hostContext.close();
  await guestContext.close();
});

test("players can vote to end a live match", async ({ browser }) => {
  test.setTimeout(60_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  const room = await createLobby(host);
  await joinListedRoom(guest, "e2e-host");
  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });

  await host.getByRole("button", { name: "End match" }).click();
  await host
    .getByRole("dialog", { name: "End this match for everyone?" })
    .getByRole("button", { name: "Start vote" })
    .click();

  const guestVote = guest.getByRole("dialog", { name: "End match vote" });
  await expect(host.getByRole("dialog", { name: "End match vote" })).toBeVisible();
  await expect(guestVote).toBeVisible();
  await guestVote.getByRole("button", { name: "Approve" }).click();

  await expect(host.getByRole("heading", { name: /wins/ })).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByRole("heading", { name: /wins/ })).toBeVisible({ timeout: 15_000 });

  const stored = await prisma.match.findUnique({ where: { id: room.id } });
  expect(stored?.status).toBe("finished");
  expect(stored?.endReason).toBe("endedByVote");
  expect(stored?.verified).toBe(true);

  await hostContext.close();
  await guestContext.close();
});

test("one opposing vote keeps a live match going", async ({ browser }) => {
  test.setTimeout(60_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");
  const room = await createLobby(host);
  await joinListedRoom(guest, "e2e-host");
  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });

  await host.getByRole("button", { name: "End match" }).click();
  await host
    .getByRole("dialog", { name: "End this match for everyone?" })
    .getByRole("button", { name: "Start vote" })
    .click();

  const guestVote = guest.getByRole("dialog", { name: "End match vote" });
  await expect(guestVote).toBeVisible();
  await guestVote.getByRole("button", { name: "Oppose" }).click();

  const failed = guest.getByRole("dialog", { name: "The end vote failed" });
  await expect(failed).toBeVisible();
  await failed.getByRole("button", { name: "Keep playing" }).click();
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();

  const stored = await prisma.match.findUnique({ where: { id: room.id } });
  expect(stored?.status).toBe("playing");

  await hostContext.close();
  await guestContext.close();
});

test("an idle player is replaced by AI", async ({ browser }) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const host = await openSetup(contexts[0]!, "e2e-idle-0");
  const guest = await openSetup(contexts[1]!, "e2e-idle-1");
  const third = await openSetup(contexts[2]!, "e2e-idle-2");
  const room = await createLobby(host, 3);
  await joinListedRoom(guest, "e2e-idle-0");
  await joinListedRoom(third, "e2e-idle-0");
  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });

  await expect
    .poll(
      async () =>
        Boolean(await prisma.matchParticipant.findFirst({ where: { matchId: room.id, isAi: true } })),
      { timeout: 20_000 },
    )
    .toBe(true);

  const hostSeat = await prisma.matchParticipant.findFirst({
    where: { matchId: room.id, nickname: "e2e-idle-0" },
  });
  if (hostSeat?.isAi) {
    await expect(host.getByRole("dialog", { name: "You are no longer in this match" })).toBeVisible();
  } else {
    await expect(host.getByRole("tab", { name: /AI/ })).toBeVisible();
  }

  const stored = await prisma.match.findUnique({ where: { id: room.id } });
  expect(stored?.status).toBe("playing");

  // Reopening the site after the takeover explains why the old seat is gone.
  const replaced = await prisma.matchParticipant.findFirst({
    where: { matchId: room.id, isAi: true },
  });
  const names = ["e2e-idle-0", "e2e-idle-1", "e2e-idle-2"];
  const replacedIndex = replaced ? names.indexOf(replaced.nickname) : -1;
  if (replacedIndex >= 0) {
    const pages = [host, guest, third];
    await pages[replacedIndex]!.close();
    const reopened = await openSetupPage(contexts[replacedIndex]!, names[replacedIndex]!, true);
    await expect(reopened.getByRole("dialog", { name: "Last online match" })).toContainText(
      "taken over by AI",
    );
    await reopened.close();
  }

  for (const context of contexts) await context.close();
});

test("online play requires a signed-in account", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await openGuestSetup(context);
  await expect(page.getByRole("button", { name: "Create room" })).toBeDisabled();
  await context.close();
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

test("another lobby tab, a reload, or a restored page keeps the seat and host role", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const friendContext = await browser.newContext();
  const first = await openSetup(context, "e2e-host");
  const room = await createLobby(first, 3);
  const friend = await openSetup(friendContext, "e2e-friend");
  await joinListedRoom(friend, "e2e-host");
  await expect(first.getByText("2/3 players")).toBeVisible();

  const second = await context.newPage();
  await second.addInitScript(() => {
    localStorage.setItem("i18nextLng", "en");
  });
  await second.goto("/");
  await expect(second.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Cancel room" })).toBeVisible();

  // Hold the remaining page's heartbeats until the hidden page's away mark lands, so the test
  // knows the seat was marked away before checking that it comes back.
  async function hideAndExpectAway(hide: () => Promise<void>): Promise<void> {
    const release = await holdHeartbeats(second);
    try {
      await hide();
      await expect.poll(() => seatAge(room.id, "e2e-host")).toBeGreaterThan(60_000);
    } finally {
      await release();
    }
  }

  // The friend's heartbeat would drop the seat once the grace runs out,
  // so it only stays if the remaining page takes it back.
  async function expectHostKeepsSeat(): Promise<void> {
    await second.waitForTimeout(12_000);
    await expect(second.getByRole("heading", { name: "Online lobby" })).toBeVisible();
    await expect(second.getByText("You are no longer in this room")).toHaveCount(0);
    await expect(second.getByRole("button", { name: "Cancel room" })).toBeVisible();
    await expect(friend.getByText("2/3 players")).toBeVisible();
    await expect(friend.getByRole("button", { name: "Leave room" })).toBeVisible();
    const stored = await prisma.match.findUnique({
      where: { id: room.id },
      include: { participants: { orderBy: { seatIndex: "asc" } } },
    });
    expect(stored?.hostSeatIndex).toBe(0);
    expect(stored?.participants.map((participant) => participant.nickname)).toEqual(["e2e-host", "e2e-friend"]);
  }

  await hideAndExpectAway(() => first.close());
  await expectHostKeepsSeat();

  await hideAndExpectAway(async () => {
    await second.reload();
    await expect(second.getByRole("heading", { name: "Online lobby" })).toBeVisible();
  });
  await expectHostKeepsSeat();

  // Playwright keeps the back-forward cache disabled, so this return is a reload too.
  await hideAndExpectAway(async () => {
    await second.evaluate(() => {
      location.assign("/api/health");
    });
    await second.waitForURL("**/api/health");
  });
  await second.evaluate(() => {
    history.back();
  });
  await expectHostKeepsSeat();

  await context.close();
  await friendContext.close();
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

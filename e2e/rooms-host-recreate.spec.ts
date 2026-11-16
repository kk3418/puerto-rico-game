import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { e2eDatabaseUrl } from "./database-url";

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
 * Put a Google account's session in a fresh browser context. The e2e suite cannot
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
    guestId: randomUUID(),
    guestNickname: displayName,
  } as unknown as Prisma.InputJsonValue;
  await prisma.session.create({ data: { sid, sess, expire } });
  await context.addCookies([
    { name: "pr.sid", value: signedSessionCookie(sid), url: E2E_ORIGIN },
  ]);
}

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

async function createRoom(page: Page, playerCount: 2 | 3 | 4 | 5 = 2): Promise<{ id: string }> {
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

/** Mimic the host reopening the site: the setup screen no longer resumes the old room. */
async function reopenSetup(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.removeItem("pr.lastMatchId"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
}

test("a signed-in host can open a new room after a playing opponent leaves", async ({ browser }) => {
  test.setTimeout(60_000);
  const hostContext = await browser.newContext();
  await signedInContext(hostContext, "e2e-login");
  const guestContext = await browser.newContext();

  const host = await openSetup(hostContext, "e2e-host");
  await expect(host.getByText("Signed in as e2e-login")).toBeVisible();
  const guest = await openSetup(guestContext, "e2e-guest");

  const room = await createRoom(host);
  await joinListedRoom(guest, "e2e-host");

  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible({
    timeout: 25_000,
  });

  // Closing the browser is how a player leaves a match that already started.
  await guestContext.close();

  await reopenSetup(host);
  const next = await createRoom(host);
  expect(next.id).not.toBe(room.id);
  await expect(host.getByRole("button", { name: "Cancel room" })).toBeVisible();

  const abandoned = await prisma.match.findUnique({ where: { id: room.id } });
  expect(abandoned?.status).toBe("abandoned");
  expect(abandoned?.endedAt).not.toBeNull();

  await hostContext.close();
});

test("a signed-in host can open a new room after a lobby guest leaves", async ({ browser }) => {
  test.setTimeout(60_000);
  const hostContext = await browser.newContext();
  await signedInContext(hostContext, "e2e-login");
  const guestContext = await browser.newContext();

  const host = await openSetup(hostContext, "e2e-host");
  await expect(host.getByText("Signed in as e2e-login")).toBeVisible();
  // Three seats keep the room in the lobby when only one guest joins.
  const room = await createRoom(host, 3);

  const guest = await openSetup(guestContext, "e2e-guest");
  await joinListedRoom(guest, "e2e-host");
  await expect(host.getByText("2/3 players")).toBeVisible();

  await guest.getByRole("button", { name: "Leave room" }).click();
  await expect(guest.getByRole("button", { name: "Create room" })).toBeVisible();
  await expect(host.getByText("1/3 players")).toBeVisible();

  await reopenSetup(host);
  const next = await createRoom(host);
  expect(next.id).not.toBe(room.id);
  await expect(host.getByRole("button", { name: "Cancel room" })).toBeVisible();

  expect(await prisma.match.findUnique({ where: { id: room.id } })).toBeNull();

  // A guest seated in the new room still cannot open a room of their own.
  const otherContext = await browser.newContext();
  const other = await openSetup(otherContext, "e2e-guest2");
  await joinListedRoom(other, "e2e-host");
  const blocked = await otherContext.request.post(`${E2E_ORIGIN}/api/rooms`, {
    data: { nickname: "e2e-guest2", playerCount: 2 },
  });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toMatchObject({ code: "ROOM_ALREADY_IN_MATCH" });

  await otherContext.close();
  await guestContext.close();
  await hostContext.close();
});

import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { e2eDatabaseUrl } from "./database-url";

const readyRequest = /\/api\/matches\/[^/?]+\?ready=1(?:&|$)/;

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
  await page.route(readyRequest, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete("ready");
    const response = await route.fetch({ url: url.toString() });
    await route.fulfill({ response });
  });
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

  await host.unroute(readyRequest);
  await guest.unroute(readyRequest);

  await expect(host.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(guest.getByRole("heading", { name: /Choose a role this round/ })).toBeVisible();
  await expect(host.getByRole("tab", { name: /e2e-host/ })).toBeVisible();
  await expect(host.getByRole("tab", { name: /e2e-guest/ })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test("closing a lobby page drops that seat", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await openSetup(hostContext, "e2e-host");
  const guest = await openSetup(guestContext, "e2e-guest");

  await host.getByRole("radio", { name: "3 players" }).check();
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host.getByRole("heading", { name: "Online lobby" })).toBeVisible();

  await guest.getByRole("button", { name: "Refresh" }).click();
  await guest.getByRole("listitem").filter({ hasText: "e2e-host" }).getByRole("button", { name: "Join" }).click();
  await expect(guest.getByRole("button", { name: "Leave room" })).toBeVisible();
  await expect(host.getByRole("listitem").filter({ hasText: "e2e-guest" })).toBeVisible();

  await guest.close();

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

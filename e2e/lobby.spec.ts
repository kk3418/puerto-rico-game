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

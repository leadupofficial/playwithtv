import { expect, test } from "@playwright/test";
import { PHONE, tvCode } from "./helpers";

/** Fires the browser's install event the way Chrome does, recording whether our button calls prompt(). */
function fakeInstallEvent() {
  addEventListener("load", () => {
    const e = new Event("beforeinstallprompt") as Event & { prompt(): Promise<void>; userChoice: Promise<unknown> };
    e.prompt = async () => { (window as unknown as { __prompted: boolean }).__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    dispatchEvent(e);
  });
}

test("Android: the join page offers Install, which opens the browser's install prompt; Not now hides it for a week", async ({ browser }) => {
  const ctx = await browser.newContext({ ...PHONE, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fakeInstallEvent);
  const page = await ctx.newPage();
  await page.goto("/join");
  const banner = page.locator(".install-banner");
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Install" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);

  await page.reload();
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Join the game/ })).toBeVisible();
  await expect(banner).toHaveCount(0); // remembered
});

test("iPhone: no install prompt exists, so the join page explains Add to Home Screen", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  await page.goto("/join");
  await expect(page.locator('.install-banner[data-platform="ios"]')).toContainText("Add to Home Screen");
});

test("TV browsers get a Save this page chip the remote can reach; the TV app never sees a prompt", async ({ browser }) => {
  const samsung = await (await browser.newContext({
    viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36",
  })).newPage();
  await samsung.goto("/tv");
  await tvCode(samsung);
  await samsung.locator(".tv-install").click();
  await expect(samsung.getByRole("dialog")).toContainText("bookmarks");
  await samsung.getByRole("button", { name: "OK" }).click();
  await expect(samsung.getByRole("dialog")).toHaveCount(0);

  const app = await (await browser.newContext({
    viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; MiTV-AXFU0; wv) AppleWebKit/537.36 Chrome/155.0 Mobile Safari/537.36 PlayWithTV/1",
  })).newPage();
  await app.addInitScript(fakeInstallEvent);
  await app.goto("/tv");
  await tvCode(app);
  await expect(app.locator(".tv-install")).toHaveCount(0);
});

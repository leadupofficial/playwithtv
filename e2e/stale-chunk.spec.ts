import { expect, test } from "@playwright/test";
import { joinPhone, tvCode } from "./helpers";

/**
 * A TV left open across a deploy asks for a game file that no longer exists. That used to open to a blank
 * screen (the server answered with the HTML page, the script failed, React unmounted everything). Now the
 * missing file is a 404, the page tries one reload, and if the file is still missing the TV shows a message
 * with a way back to the games.
 */
test("a game file that can't be loaded shows a message, never a blank screen", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await ctx.newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  await joinPhone(browser, code, "Ana");
  await expect(tv.locator(".player", { hasText: "Ana" })).toBeVisible({ timeout: 15_000 });

  // "deploy": every script file the TV hasn't loaded yet is gone
  const loaded = new Set(await tv.evaluate(() => performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname)));
  test.skip(![...loaded].some((p) => p.startsWith("/assets/")), "needs a production build (playwright.prod.config.ts): the dev server has no hashed files");
  await ctx.route(/\/assets\/[^/]+\.js$/, (route) => (loaded.has(new URL(route.request().url()).pathname) ? route.continue() : route.fulfill({ status: 404, body: "Not found" })));

  await tv.locator(".game-card", { hasText: "Drop Four" }).first().click();
  await tv.getByRole("button", { name: /Start Drop Four/ }).click();
  const crash = tv.locator("[data-crash]");
  await expect(crash).toBeVisible({ timeout: 20_000 });
  await expect(crash).toContainText("couldn't be loaded");
  expect((await tv.locator("#root").innerText()).trim().length).toBeGreaterThan(10);

  // the file is back (the reload picked up the new build): Back to games returns to the lobby
  await ctx.unroute(/\/assets\/[^/]+\.js$/);
  await tv.getByRole("button", { name: "Back to games" }).click();
  await expect(tv.locator(".tv-header")).toBeVisible({ timeout: 10_000 });
});

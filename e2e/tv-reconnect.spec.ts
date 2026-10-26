import { expect, test, type WebSocketRoute } from "@playwright/test";
import { joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

/**
 * The TV loses its hub connection mid-game (Wi-Fi blip): the game must stop, phones must say why, and
 * play carries on from the same moment when the TV is back. Uses Kitchen Rush, whose shift clock is on the HUD.
 */
test("TV connection drop mid-game pauses the game and resumes it where it stopped", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  // Every TV WebSocket goes through here, so the test can cut it and refuse reconnects for a while.
  let blocked = false;
  let live: { page: WebSocketRoute; server: WebSocketRoute } | null = null;
  await tv.routeWebSocket(/\/ws$/, (ws) => {
    if (blocked) return void ws.close({ code: 4000, reason: "offline" });
    live = { page: ws, server: ws.connectToServer() };
  });
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const ana = await joinPhone(browser, code, "Ana", { "Kitchen Rush": "buttons" });
  const ben = await joinPhone(browser, code, "Ben", { "Kitchen Rush": "buttons" });
  await tv.locator(".shelf", { hasText: "Couples" }).click();
  await tv.locator(".game-card", { hasText: "Kitchen Rush" }).click();
  await tv.getByRole("button", { name: /Start Kitchen Rush/ }).click();
  await practiseUntilReady(tv, ana, "Ana", ["btn:✋ Grab"] as never);
  await practiseUntilReady(tv, ben, "Ben", ["btn:✋ Grab"] as never);

  const g = async () => JSON.parse((await tv.locator("[data-grid]").getAttribute("data-grid")) || "{}");
  const clock = async () => /⏱ (\d+):(\d+)/.exec((await g()).hud?.goal ?? "")?.slice(1).reduce((m, s) => m * 60 + Number(s), 0) ?? -1;
  await expect.poll(async () => (await g()).phase, { timeout: 15_000 }).toBe("map");
  await press(ana, /Play/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("story");
  await press(ana, /Start/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("play");
  await expect.poll(clock, { timeout: 5_000 }).toBeGreaterThan(0);
  const start = await clock();
  await expect.poll(clock, { timeout: 5_000 }).toBeLessThan(start); // the shift clock runs

  // the TV drops off the hub and cannot get back for a while
  blocked = true;
  await live!.server.close({ code: 4000, reason: "drop" });
  await live!.page.close({ code: 4000, reason: "drop" });
  await expect(tv.getByText("Reconnecting…")).toBeVisible();
  await expect(ana.locator("[data-paused=tv]")).toBeVisible();
  const frozen = await clock();
  await tv.waitForTimeout(3500);
  expect(await clock()).toBe(frozen); // the game did not run on without the hub

  // back online: the game carries on from where it stopped, the phones' pause notice goes
  blocked = false;
  await expect(tv.getByText("Reconnecting…")).toBeHidden({ timeout: 10_000 });
  await expect(ana.locator("[data-paused]")).toBeHidden();
  await expect.poll(clock, { timeout: 5_000 }).toBeLessThan(frozen);
  expect(frozen - (await clock())).toBeLessThanOrEqual(3); // resumed from the frozen time, not 3.5 s + later
  expect((await g()).phase).toBe("play");
  expect(errors).toEqual([]);
});

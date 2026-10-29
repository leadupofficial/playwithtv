import { expect, test } from "@playwright/test";
import { gesture, joinPhone, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

test("Sky Gyro Racer: two phones race split-screen, steer by turning and boost with a push", async ({ browser }) => {
  test.setTimeout(180_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const a = await joinPhone(browser, code, "Ravi");                                  // hybrid (the default)
  const b = await joinPhone(browser, code, "Divya", { "Sky Gyro Racer": "motion" });
  await tv.locator(".game-card", { hasText: "Sky Gyro Racer" }).click();
  await tv.getByRole("button", { name: /Start Sky Gyro Racer/ }).click();
  await practiseUntilReady(tv, a, "Ravi", ["btn:BOOST"]);
  await practiseUntilReady(tv, b, "Divya", ["push"]);

  const race = () => tv.locator("[data-racer]").getAttribute("data-racer").then((s) => JSON.parse(s || "{}"));
  await expect.poll(async () => (await race()).time ?? 0, { timeout: 15_000 }).toBeGreaterThan(0.5);
  await expect(tv.locator(".racer-hud")).toHaveCount(2);            // split screen
  await pose(a, upright(25));                                       // Ravi steers right…
  await expect.poll(async () => (await race()).ships?.[0]?.dist ?? 0).toBeGreaterThan(30);
  await gesture(b, "push");                                         // …Divya boosts by pushing (motion)
  await expect.poll(async () => (await race()).ships?.[1]?.boosts ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
  await press(a, "BOOST");                                          // …and Ravi with the button (hybrid)
  await expect.poll(async () => (await race()).ships?.[0]?.boosts ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
  await tv.screenshot({ path: "test-results/racer-split.png" });
  await pose(a, upright(0));

  await expect.poll(async () => (await race()).over, { timeout: 90_000 }).toBe(true);
  await expect(a.getByText(/You won the race!|You finished #|You came #|You won/).first()).toBeVisible({ timeout: 10_000 }); // the 3 s outcome, or the results after it
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Sky Gyro Racer solo: one phone races two computer rivals, results list only the player, a rematch shows the best", async ({ browser }) => {
  test.setTimeout(240_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const a = await joinPhone(browser, code, "Solo");
  await tv.locator(".game-card", { hasText: "Sky Gyro Racer" }).click();
  await tv.getByRole("button", { name: /Start Sky Gyro Racer/ }).click();
  await practiseUntilReady(tv, a, "Solo", ["btn:BOOST"]);

  const race = () => tv.locator("[data-racer]").getAttribute("data-racer").then((s) => JSON.parse(s || "{}"));
  await expect(tv.locator(".racer-rivals")).toHaveText("vs Captain Kite & Rocket Rani");
  await expect.poll(async () => (await race()).ships?.length ?? 0, { timeout: 15_000 }).toBe(3);
  await expect(tv.locator(".racer-hud")).toHaveCount(1);             // the rivals fly, but get no screen of their own
  await expect(tv.locator(".rh-place")).toHaveText(/^#[123]$/);
  await expect.poll(async () => Math.min(...((await race()).ships ?? []).slice(1).map((s: { dist: number }) => s.dist)), { timeout: 15_000 }).toBeGreaterThan(20);
  await tv.screenshot({ path: "test-results/racer-solo.png" });

  await expect.poll(async () => (await race()).over, { timeout: 90_000 }).toBe(true);
  await expect(a.getByText(/You won the race!|You finished #|You came #|You won/).first()).toBeVisible({ timeout: 10_000 }); // the 3 s outcome, or the results after it
  await expect(tv.locator(".podium-row")).toHaveCount(1, { timeout: 15_000 }); // no computer rows on the results
  await expect(tv.locator(".podium-row .best")).toHaveCount(0);       // a first game sets the best silently

  await tv.getByRole("button", { name: /Rematch/ }).click();
  await expect(tv.locator(".podium-row")).toHaveCount(0);            // results gone: the helper sees the get-ready screen
  await practiseUntilReady(tv, a, "Solo", ["btn:BOOST"]);
  await expect.poll(async () => (await race()).time ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.5);
  await expect.poll(async () => (await race()).over, { timeout: 90_000 }).toBe(true);
  await expect(tv.locator(".podium-row .best")).toHaveText(/^(⭐ New best!|Equals your best|Your best: \d+)$/, { timeout: 15_000 });
  await tv.waitForTimeout(1_000);                                     // let the rows finish popping in
  await tv.screenshot({ path: "test-results/racer-solo-results.png" });
});

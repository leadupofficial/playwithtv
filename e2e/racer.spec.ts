import { expect, test } from "@playwright/test";
import { gesture, joinPhone, pose, practiseUntilReady, tvCode, upright } from "./helpers";

test("Sky Gyro Racer: two phones race split-screen, steer by turning and boost with a push", async ({ browser }) => {
  test.setTimeout(180_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const a = await joinPhone(browser, code, "Ravi");
  const b = await joinPhone(browser, code, "Divya");
  await tv.locator(".game-card", { hasText: "Sky Gyro Racer" }).click();
  await tv.getByRole("button", { name: /Start Sky Gyro Racer/ }).click();
  await practiseUntilReady(tv, a, "Ravi", ["push"]);
  await practiseUntilReady(tv, b, "Divya", ["push"]);

  const race = () => tv.locator("[data-racer]").getAttribute("data-racer").then((s) => JSON.parse(s || "{}"));
  await expect.poll(async () => (await race()).time ?? 0, { timeout: 15_000 }).toBeGreaterThan(0.5);
  await expect(tv.locator(".racer-hud")).toHaveCount(2);            // split screen
  await pose(a, upright(25));                                       // Ravi steers right…
  await expect.poll(async () => (await race()).ships?.[0]?.dist ?? 0).toBeGreaterThan(30);
  await gesture(b, "push");                                         // …Divya boosts
  await expect.poll(async () => (await race()).ships?.[1]?.boosts ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
  await tv.screenshot({ path: "test-results/racer-split.png" });
  await pose(a, upright(0));

  await expect.poll(async () => (await race()).over, { timeout: 90_000 }).toBe(true);
  await expect(a.getByText(/You won the race!|You finished #/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

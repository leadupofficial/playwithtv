import { expect, test } from "@playwright/test";
import { flat, joinPhone, pose, practiseUntilReady, press, tvCode } from "./helpers";

/**
 * Carry Me Home: two phones carry one sofa together. One player steers with the joystick, the other by
 * tilting; both ends move, the sofa keeps its length, and the HUD names both carriers.
 */
test("Carry Me Home: joystick and tilt carry the sofa together", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const ana = await joinPhone(browser, code, "Ana", { "Carry Me Home": "buttons" });
  const ben = await joinPhone(browser, code, "Ben", { "Carry Me Home": "motion" });
  await pose(ben, flat(0, 0)); // hold it like a tray before starting

  await tv.locator(".shelf", { hasText: "Couples" }).click();
  await expect(tv.locator(".game-card", { hasText: "Carry Me Home" })).toBeVisible();
  await tv.locator(".game-card", { hasText: "Carry Me Home" }).click();
  await tv.getByRole("button", { name: /Start Carry Me Home/ }).click();
  await practiseUntilReady(tv, ana, "Ana", ["btn:▶ Go"] as never);
  await practiseUntilReady(tv, ben, "Ben", ["pull"]);

  const g = async () => JSON.parse((await tv.locator("[data-grid]").getAttribute("data-grid")) || "{}");
  await expect.poll(async () => (await g()).phase, { timeout: 15_000 }).toBe("map");
  await press(ana, /Play|Go/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("story");
  await tv.screenshot({ path: "test-results/carry-story.png" });
  await press(ana, /Start|Go|Play/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("play");
  await expect(tv.locator(".grid-pilot")).toContainText("Ana + Ben");

  const start = (await g()).ends as Array<{ x: number; y: number }>;
  // Ana pushes her joystick down, Ben tips his tray towards himself (near edge down = down the TV screen, like a ball in a tray)
  const stick = ana.locator(".game-pad .stick");
  const box = (await stick.boundingBox())!;
  await ana.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ana.mouse.down();
  await ana.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 4 });
  await pose(ben, flat(0, -22), 200);
  await expect.poll(async () => (await g()).ends[0].y, { timeout: 5_000 }).toBeGreaterThan(start[0]!.y + 1);
  await expect.poll(async () => (await g()).ends[1].y, { timeout: 5_000 }).toBeGreaterThan(start[1]!.y + 1);
  await tv.screenshot({ path: "test-results/carry-play.png" });
  await ana.mouse.up();
  await pose(ben, flat(0, 0), 300);
  const e = (await g()).ends as Array<{ x: number; y: number }>;
  expect(Math.hypot(e[1]!.x - e[0]!.x, e[1]!.y - e[0]!.y)).toBeCloseTo(3, 0);
  expect(errors).toEqual([]);
});

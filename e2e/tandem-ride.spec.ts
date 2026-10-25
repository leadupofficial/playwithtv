import { expect, test } from "@playwright/test";
import { flat, joinPhone, pose, practiseUntilReady, press, tvCode } from "./helpers";

/**
 * Tandem Ride: Ana pedals with the joystick, Ben by rocking his phone; the bike only moves when they pedal,
 * and pressing Jump together gives the big jump.
 */
test("Tandem Ride: joystick and tilt riders pedal the bike and jump together", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const ana = await joinPhone(browser, code, "Ana", { "Tandem Ride": "buttons" });
  const ben = await joinPhone(browser, code, "Ben", { "Tandem Ride": "hybrid" });
  await pose(ben, flat(0, 0));

  await tv.locator(".shelf", { hasText: "Couples" }).click();
  await tv.locator(".game-card", { hasText: "Tandem Ride" }).click();
  await tv.getByRole("button", { name: /Start Tandem Ride/ }).click();
  await practiseUntilReady(tv, ana, "Ana", ["btn:⬆ Jump"] as never);
  await practiseUntilReady(tv, ben, "Ben", ["btn:⬆ Jump"] as never);

  const g = async () => JSON.parse((await tv.locator("[data-grid]").getAttribute("data-grid")) || "{}");
  await expect.poll(async () => (await g()).phase, { timeout: 15_000 }).toBe("map");
  await press(ana, /Play/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("story");
  await press(ana, /Start/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("play");
  await expect(ana.getByRole("button", { name: /Done/ })).toHaveCount(0);

  // standing still: the bike doesn't move
  await tv.waitForTimeout(500);
  const x0 = (await g()).x as number;
  expect(x0).toBeLessThan(2.3);

  // both pedal: Ana swings the joystick, Ben rocks his phone
  const stick = ana.locator(".game-pad .stick");
  const box = (await stick.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await ana.mouse.move(cx, cy);
  await ana.mouse.down();
  for (let i = 0; i < 8; i++) {
    const s = i % 2 ? 1 : -1;
    await Promise.all([ana.mouse.move(cx + s * box.width * 0.4, cy, { steps: 2 }), pose(ben, flat(s * 25, 0), 120)]);
    await tv.waitForTimeout(120);
  }
  await ana.mouse.up();
  await expect.poll(async () => (await g()).strokes[0] as number, { timeout: 3_000 }).toBeGreaterThanOrEqual(6);
  await expect.poll(async () => (await g()).strokes[1] as number, { timeout: 3_000 }).toBeGreaterThanOrEqual(4);
  expect((await g()).x).toBeGreaterThan(x0 + 2);
  await pose(ben, flat(0, 0), 100);

  // Jump together: a big jump
  await Promise.all([press(ana, /Jump/), press(ben, /Jump/)]);
  await expect.poll(async () => (await g()).big, { timeout: 2_000, intervals: [30] }).toBe(true);
  await tv.screenshot({ path: "test-results/tandem-play.png" });
  expect(errors).toEqual([]);
});

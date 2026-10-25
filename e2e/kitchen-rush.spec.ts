import { expect, test } from "@playwright/test";
import { flat, joinPhone, pose, practiseUntilReady, press, tvCode } from "./helpers";

/**
 * Kitchen Rush: two chefs, one kitchen. One player walks with the joystick, the other by tilting; ✋ Grab
 * picks lettuce out of the crate, and the level-picker arrows are hidden while you cook.
 */
test("Kitchen Rush: joystick and tilt chefs walk, grab and get told off", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const ana = await joinPhone(browser, code, "Ana", { "Kitchen Rush": "buttons" });
  const ben = await joinPhone(browser, code, "Ben", { "Kitchen Rush": "hybrid" });
  await pose(ben, flat(0, 0));

  await tv.locator(".shelf", { hasText: "Couples" }).click();
  await tv.locator(".game-card", { hasText: "Kitchen Rush" }).click();
  await tv.getByRole("button", { name: /Start Kitchen Rush/ }).click();
  await practiseUntilReady(tv, ana, "Ana", ["btn:✋ Grab"] as never);
  await practiseUntilReady(tv, ben, "Ben", ["btn:✋ Grab"] as never);

  const g = async () => JSON.parse((await tv.locator("[data-grid]").getAttribute("data-grid")) || "{}");
  await expect.poll(async () => (await g()).phase, { timeout: 15_000 }).toBe("map");
  await press(ana, /Play/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("story");
  await press(ana, /Start/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("play");
  await expect(tv.locator(".grid-pilot")).toContainText("Ana + Ben");
  await expect(ana.getByRole("button", { name: /Prev/ })).toHaveCount(0);
  await expect(ana.getByRole("button", { name: /Chop/ })).toBeVisible();

  // Ana walks right along the top counter until she's under the lettuce crate, then faces it and grabs
  const chef = async (i: number) => (await g()).chefs[i] as { x: number; y: number; hand: string | null };
  const stick = ana.locator(".game-pad .stick");
  const box = (await stick.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await ana.mouse.move(cx, cy);
  await ana.mouse.down();
  await ana.mouse.move(cx + box.width * 0.3, cy, { steps: 3 });
  await expect.poll(async () => (await chef(0)).x, { timeout: 5_000, intervals: [50] }).toBeGreaterThan(2.2);
  await ana.mouse.move(cx, cy - box.height * 0.45, { steps: 2 });
  await tv.waitForTimeout(150);
  await ana.mouse.up();
  const x = (await chef(0)).x;
  expect(x).toBeGreaterThan(2);
  expect(x).toBeLessThan(3);
  await press(ana, /Grab/);
  await expect.poll(async () => (await chef(0)).hand, { timeout: 3_000 }).toBe("lettuce:raw");

  // Ben tilts to walk his chef up the kitchen
  const before = await chef(1);
  await pose(ben, flat(0, 20), 200);
  await expect.poll(async () => (await chef(1)).y, { timeout: 5_000 }).toBeLessThan(before.y - 1);
  await pose(ben, flat(0, 0), 200);
  await tv.screenshot({ path: "test-results/kitchen-play.png" });
  expect(errors).toEqual([]);
});

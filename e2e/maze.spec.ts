import { expect, test } from "@playwright/test";
import { flat, joinPhone, pose, practiseUntilReady, tvCode } from "./helpers";

test("Gravity Maze 3D: a phone held flat tilts the board and rolls the ball into the goal", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const phone = await joinPhone(browser, code, "Meena");
  await pose(phone, flat(0, 0));                       // hold it like a tray before starting
  await tv.locator(".game-card", { hasText: "Gravity Maze 3D" }).click();
  await tv.getByRole("button", { name: /Start Gravity Maze 3D/ }).click();
  await practiseUntilReady(tv, phone, "Meena", []);

  const maze = () => tv.locator("[data-maze]").getAttribute("data-maze").then((s) => JSON.parse(s || "{}"));
  await expect.poll(async () => (await maze()).phase, { timeout: 15_000 }).toBe("play");
  const start = await maze();
  await pose(phone, flat(0, 0), 1000);
  expect((await maze()).x).toBeCloseTo(start.x, 0);    // level phone: the ball stays put
  await tv.screenshot({ path: "test-results/maze-start.png" });

  await pose(phone, flat(22, 0), 0);                   // tip the right edge down
  await expect.poll(async () => (await maze()).x, { timeout: 5_000 }).toBeGreaterThan(start.x + 2);
  await tv.screenshot({ path: "test-results/maze-rolling.png" });
  // reaching the goal scores 500 + time bonus + coins
  await expect.poll(async () => Object.values((await maze()).totals ?? {})[0] ?? 0, { timeout: 20_000 }).toBeGreaterThan(1000);

  await expect(phone.getByText(/Maze complete!/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Gravity Maze 3D with the joystick: pushing it right rolls the ball right", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const phone = await joinPhone(browser, code, "Stick", { "Gravity Maze 3D": "buttons" });
  await tv.locator(".game-card", { hasText: "Gravity Maze 3D" }).click();
  await tv.getByRole("button", { name: /Start Gravity Maze 3D/ }).click();
  await practiseUntilReady(tv, phone, "Stick", []);
  const maze = () => tv.locator("[data-maze]").getAttribute("data-maze").then((s) => JSON.parse(s || "{}"));
  await expect.poll(async () => (await maze()).phase, { timeout: 15_000 }).toBe("play");
  const start = (await maze()).x;
  const stick = phone.locator(".game-pad .stick");
  const box = (await stick.boundingBox())!;
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 5 });
  await expect.poll(async () => (await maze()).x, { timeout: 5_000 }).toBeGreaterThan(start + 2);
  await phone.mouse.up();
});

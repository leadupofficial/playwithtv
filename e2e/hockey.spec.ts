import { expect, test, type Browser, type Page } from "@playwright/test";
import { flat, joinPhone, padPoint, pose, practiseUntilReady, press, tvCode } from "./helpers";

type Hockey = { phase: string; score: [number, number]; winner: number | null; puck: { x: number; y: number; vx: number; vy: number }; strikers: Array<{ x: number; y: number; hits: number }> };

// mirrors games/hockey/engine.ts (left player's half): x in [-1 + R, -R], y in [-(0.55 - R), 0.55 - R]
const R = 0.075, X0 = -1 + R, X1 = -R, Y1 = 0.55 - R;
const toPad = (x: number, y: number): [number, number] => [Math.max(-1, Math.min(1, ((x - X0) / (X1 - X0)) * 2 - 1)), Math.max(-1, Math.min(1, y / Y1))];

async function hockeyTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => (): Promise<Hockey> => tv.locator("[data-hockey]").getAttribute("data-hockey").then((s) => JSON.parse(s || "{}"));
async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Air Hockey Motion" }).click();
  await tv.getByRole("button", { name: /Start Air Hockey Motion/ }).click();
}

test("Air Hockey Motion on the touchpad (the default): the striker follows the finger, hits the puck, the match ends", async ({ browser }) => {
  test.setTimeout(300_000);
  const { tv, code } = await hockeyTv(browser);
  const phone = await joinPhone(browser, code, "Nila");
  await start(tv);
  await practiseUntilReady(tv, phone, "Nila", []);
  const state = stateOf(tv);
  await expect.poll(async () => (await state()).phase, { timeout: 15_000 }).toBe("play");
  await expect(phone.locator('.game-pad[data-mode="touchpad"] .touchpad')).toBeVisible();

  // absolute mapping: the pad's top-left corner is the top of the player's own goal end
  const corner = await padPoint(phone, -0.9, 0.9);
  await phone.mouse.move(corner.x, corner.y);
  await phone.mouse.down();
  await expect.poll(async () => (await state()).strikers[0]!.x, { timeout: 3_000 }).toBeLessThan(-0.8);
  await expect.poll(async () => (await state()).strikers[0]!.y, { timeout: 3_000 }).toBeGreaterThan(0.3);
  await phone.mouse.up();
  await tv.waitForTimeout(300);
  const held = (await state()).strikers[0]!;
  expect(held.y).toBeGreaterThan(0.3);                                  // lifting the finger leaves it there

  // chase the puck: get behind it, then drive through it towards the CPU's goal
  let shot = false;
  const until = Date.now() + 220_000;
  await phone.mouse.down();
  let last: Hockey | null = null, overShot = false;
  while (Date.now() < until) {
    if (!(await tv.locator("[data-hockey]").count())) break;          // the results screen is up
    const s = await state().catch(() => null);
    if (!s?.puck) break;
    last = s;
    if (s.phase === "over") {
      if (!overShot) { overShot = true; await tv.screenshot({ path: "test-results/hockey-over.png" }); }
      break;
    }
    if (!(await phone.locator(".game-pad .touchpad").count())) break;  // the phone shows the result
    const p = s.puck;
    if (p.x < -0.02 && s.phase === "play") {
      const me = s.strikers[0]!;
      const behind = me.x < p.x - 0.05;
      const [tx, ty] = behind ? toPad(p.x + 0.25, p.y) : toPad(p.x - 0.16, p.y + (me.y > p.y ? 0.12 : -0.12));
      const pt = await padPoint(phone, tx, ty);
      await phone.mouse.move(pt.x, pt.y, { steps: 2 });
    } else {
      const pt = await padPoint(phone, ...toPad(-0.8, p.y * 0.6));
      await phone.mouse.move(pt.x, pt.y, { steps: 2 });
    }
    if (!shot && s.strikers[0]!.hits > 0) {
      shot = true;
      await tv.screenshot({ path: "test-results/hockey-touchpad.png" });
      await phone.screenshot({ path: "test-results/hockey-pad.png" });
    }
    await tv.waitForTimeout(60);
  }
  await phone.mouse.up();
  expect(shot).toBe(true);
  expect(last).not.toBeNull();
  expect(last!.score[0] + last!.score[1]).toBeGreaterThan(0);          // goals were scored
  await expect(phone.getByText(/You won the match!|You lost/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Air Hockey Motion head to head: joystick and SMASH against a tilting player", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await hockeyTv(browser);
  const a = await joinPhone(browser, code, "Stick", { "Air Hockey Motion": "buttons" });
  const b = await joinPhone(browser, code, "Tilt", { "Air Hockey Motion": "motion" });
  await pose(b, flat(0, 0));
  await start(tv);
  await practiseUntilReady(tv, a, "Stick", []);
  await practiseUntilReady(tv, b, "Tilt", []);
  const state = stateOf(tv);
  await expect.poll(async () => (await state()).phase, { timeout: 15_000 }).toBe("play");
  await expect(a.locator(".game-pad .action", { hasText: "SMASH" })).toBeVisible();

  // the joystick drives the left striker upwards (velocity, so it keeps going while held)
  const y0 = (await state()).strikers[0]!.y;
  const stick = a.locator(".game-pad .stick");
  const box = (await stick.boundingBox())!;
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width / 2, box.y + box.height * 0.05, { steps: 4 });
  await expect.poll(async () => (await state()).strikers[0]!.y, { timeout: 5_000 }).toBeGreaterThan(y0 + 0.2);
  await a.mouse.up();
  await press(a, "SMASH");

  // tilting moves the right striker across its half (tip the right edge down = towards the right)
  const x0 = (await state()).strikers[1]!.x;
  await pose(b, flat(22, 0), 600);
  await expect.poll(async () => (await state()).strikers[1]!.x, { timeout: 5_000 }).toBeGreaterThan(x0 + 0.1);
  await pose(b, flat(0, 22), 600);
  await expect.poll(async () => (await state()).strikers[1]!.y, { timeout: 5_000 }).toBeGreaterThan(0.15);
  await tv.screenshot({ path: "test-results/hockey-versus.png" });
  await pose(b, flat(0, 0), 200);
});

import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, padDrag, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

type T = { k: string; x: number; y: number; vx: number; vy: number };
type B = { id: string; score: number; cuts: number; bombs: number; combo: number; x: number; y: number; stun: boolean };
type S = { phase?: string; time?: number; left?: number; blades?: B[]; targets?: T[] };
const W = 1280, H = 720;

async function bladeTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<S> => {
  const s = await tv.locator("[data-blade]").getAttribute("data-blade", { timeout: 2000 }).catch(() => null);
  return JSON.parse(s || "{}");
};
/** Where a target will be in `dt` seconds (gravity 900 px/s²). */
const ahead = (t: T, dt: number) => ({ x: t.x + t.vx * dt, y: t.y + t.vy * dt + 450 * dt * dt });
/** The best target to go for: not a mine, in view, slow near the top of its arc. */
function pick(s: S, dt: number) {
  const ok = (s.targets ?? []).filter((t) => t.k !== "bomb").map((t) => ({ t, p: ahead(t, dt) }))
    .filter(({ p }) => p.x > 80 && p.x < W - 80 && p.y > 90 && p.y < H - 120);
  ok.sort((a, b) => Math.abs(a.t.vy) - Math.abs(b.t.vy));
  return ok[0] ?? null;
}
const toPad = (x: number, y: number): [number, number] => [(x / W) * 2 - 1, 1 - (y / H) * 2];

test("Motion Blade Trial with the touchpad (the default): fast drags slice the targets, the round ends with results", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await bladeTv(browser);
  const phone = await joinPhone(browser, code, "Dev");
  await tv.locator(".game-card", { hasText: "Motion Blade Trial" }).click();
  await tv.getByRole("button", { name: /Start Motion Blade Trial/ }).click();
  await expect(tv.locator(".tut-card[data-player=Dev]")).toHaveAttribute("data-mode", "touchpad", { timeout: 15_000 });
  await practiseUntilReady(tv, phone, "Dev", ["pad:swipe-up"]);
  const state = stateOf(tv);
  await expect.poll(async () => (await state()).phase, { timeout: 15_000 }).toBe("play");

  let shot = false, best = 0;
  while (true) {
    const s = await state();
    if (s.phase !== "play") break;
    best = Math.max(best, s.blades?.[0]?.score ?? 0);
    const c = pick(s, 0.2);
    if (!c) { await tv.waitForTimeout(80); continue; }
    try {
      await padDrag(phone, toPad(c.p.x - 280, c.p.y), toPad(c.p.x + 280, c.p.y), 180, 9); // a quick slash through it
    } catch {
      break; // the round ended: the phone now shows the result
    }
    if (!shot && (s.blades?.[0]?.cuts ?? 0) >= 2) {
      shot = true;
      await tv.screenshot({ path: "test-results/blade-touchpad.png" });
      await phone.screenshot({ path: "test-results/blade-pad-touchpad.png" });
    }
  }
  console.log("blade touchpad best score", best);
  expect(best).toBeGreaterThanOrEqual(20); // at least two targets sliced
  await expect(phone.getByText(/Trial complete!/)).toBeVisible({ timeout: 10_000 });
  await tv.screenshot({ path: "test-results/blade-end.png" });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Motion Blade Trial with motion and buttons together: tilt-aim + flick, joystick + SLASH, both score", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await bladeTv(browser);
  const mo = await joinPhone(browser, code, "Esha", { "Motion Blade Trial": "motion" });
  const bt = await joinPhone(browser, code, "Farid", { "Motion Blade Trial": "buttons" });
  await tv.locator(".game-card", { hasText: "Motion Blade Trial" }).click();
  await tv.getByRole("button", { name: /Start Motion Blade Trial/ }).click();
  await practiseUntilReady(tv, mo, "Esha", ["flick-up"]);
  await practiseUntilReady(tv, bt, "Farid", ["btn:SLASH"]);
  const state = stateOf(tv);
  await expect.poll(async () => (await state()).phase, { timeout: 15_000 }).toBe("play");
  let shot = false;

  // Esha: tilt so the blade points at a target, then a gentle flick sideways slashes through it
  const motionLoop = async () => {
    const deg = (v: number) => Math.sign(v) * (3 + Math.min(1, Math.abs(v)) * 25);
    while (true) {
      const s = await state();
      if (s.phase !== "play") return;
      const c = pick(s, 0.55);
      if (!c) { await mo.waitForTimeout(80); continue; }
      const ax = (c.p.x - W / 2) / (W * 0.47), ay = (H / 2 - c.p.y) / (H * 0.47);
      await pose(mo, upright(deg(ax), deg(ay)), 300);
      await gesture(mo, c.t.vx > 0 ? "flick-right" : "flick-left");
    }
  };
  // Farid: steer the joystick towards a target, tap SLASH when the blade is on it
  const buttonsLoop = async () => {
    const stick = bt.locator(".game-pad .stick");
    const box = (await stick.boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2, rad = box.width / 2;
    await bt.mouse.move(cx, cy);
    await bt.mouse.down();
    while (true) {
      const s = await state();
      if (s.phase !== "play") break;
      const me = s.blades?.[1];
      const c = pick(s, 0.15);
      if (!me || !c) { await bt.waitForTimeout(60); continue; }
      const dx = c.p.x - me.x, dy = c.p.y - me.y;
      const d = Math.hypot(dx, dy);
      const k = Math.min(1, d / 250);
      await bt.mouse.move(cx + (dx / (d || 1)) * k * rad * 0.9, cy + (dy / (d || 1)) * k * rad * 0.9);
      if (d < 90) await press(bt, "SLASH").catch(() => undefined);
      else await bt.waitForTimeout(40);
      if (!shot && (s.blades?.[0]?.cuts ?? 0) + (s.blades?.[1]?.cuts ?? 0) >= 3) {
        shot = true;
        await tv.screenshot({ path: "test-results/blade-duo.png" });
        await bt.screenshot({ path: "test-results/blade-pad-buttons.png" });
      }
    }
    await bt.mouse.up().catch(() => undefined);
  };
  let last: S = {};
  const watch = async () => { while (true) { const s = await state(); if (s.phase !== "play") return; last = s; await tv.waitForTimeout(100); } };
  await Promise.all([motionLoop().catch(() => undefined), buttonsLoop().catch(() => undefined), watch()]);
  console.log("blade duo", JSON.stringify(last.blades));
  expect(last.blades?.[0]?.cuts ?? 0).toBeGreaterThanOrEqual(1); // motion sliced
  expect(last.blades?.[1]?.cuts ?? 0).toBeGreaterThanOrEqual(1); // buttons sliced
  await expect(mo.getByText(/You won!|#2/)).toBeVisible({ timeout: 10_000 });
  await expect(bt.getByText(/You won!|#2/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

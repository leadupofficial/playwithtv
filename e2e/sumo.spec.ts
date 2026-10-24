import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

type W = { id: string; name: string; cpu: boolean; x: number; y: number; out: boolean; wins: number; ringouts: number; shoves: number };
type SumoDbg = { phase: string; round: number; ring: number; winner: string | null; w: W[] };

async function sumoTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<SumoDbg> => JSON.parse((await tv.locator("[data-sumo]").getAttribute("data-sumo")) || "{}");
async function startSumo(tv: Page) {
  await tv.locator(".game-card", { hasText: "Motion Sumo" }).click();
  await tv.getByRole("button", { name: /Start Motion Sumo/ }).click();
}
/** Unit vector (stick axes: x right, y up) from me to the nearest wrestler still in the ring. */
function aim(s: SumoDbg, name: string) {
  const me = s.w.find((w) => w.name === name)!;
  let best: W | null = null, bd = Infinity;
  for (const w of s.w) {
    if (w === me || w.out) continue;
    const d = Math.hypot(w.x - me.x, w.y - me.y);
    if (d < bd) { bd = d; best = w; }
  }
  if (!best) return { x: 0, y: 0, d: Infinity, me };
  return { x: (best.x - me.x) / bd, y: -(best.y - me.y) / bd, d: bd, me };
}

test("Motion Sumo with the joystick (the default): walk at the CPU wrestlers, shove them, and the match ends", async ({ browser }) => {
  test.setTimeout(180_000);
  const { tv, code } = await sumoTv(browser);
  const phone = await joinPhone(browser, code, "Kavin");
  await startSumo(tv);
  await practiseUntilReady(tv, phone, "Kavin", ["btn:SHOVE"]);
  const bout = stateOf(tv);
  await expect.poll(async () => (await bout()).phase, { timeout: 15_000 }).toBe("fight");
  expect((await bout()).w).toHaveLength(4); // filled with CPU wrestlers
  await expect(phone.locator('.game-pad[data-mode="buttons"] .stick')).toBeVisible();
  const stick = phone.locator(".game-pad .stick").first();
  const box = (await stick.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) / 2;
  await stick.dispatchEvent("pointerdown", { pointerId: 5, clientX: cx, clientY: cy });
  let shot = false;
  const start = (await bout()).w.find((w) => w.name === "Kavin")!;
  let moved = 0, shoveTick = 0;
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    const s = await bout();
    if (s.phase === "over") break;
    const a = aim(s, "Kavin");
    moved = Math.max(moved, Math.hypot(a.me.x - start.x, a.me.y - start.y));
    if (!a.me.out && s.phase === "fight") {
      await stick.dispatchEvent("pointermove", { pointerId: 5, clientX: cx + a.x * r * 0.9, clientY: cy - a.y * r * 0.9 }, { timeout: 2000 }).catch(() => undefined);
      if (a.d < 120 || shoveTick++ % 8 === 2) await press(phone, "SHOVE").catch(() => undefined);
    }
    if (!shot && s.w.some((w) => w.out)) {
      shot = true;
      await tv.screenshot({ path: "test-results/sumo-buttons.png" });
      await phone.screenshot({ path: "test-results/sumo-pad.png" });
    }
    await tv.waitForTimeout(100);
  }
  const end = await bout();
  expect(end.phase).toBe("over");
  expect(end.winner).not.toBeNull();
  const me = end.w.find((w) => w.name === "Kavin")!;
  expect(me.shoves).toBeGreaterThan(0);
  expect(moved).toBeGreaterThan(60);
  expect(end.w.filter((w) => w.out).length).toBeGreaterThanOrEqual(3); // ring-outs happened until one was left
  await tv.screenshot({ path: "test-results/sumo-over.png" });
  await expect(phone.getByText(/You are the champion!|is the champion/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Motion Sumo with motion and touchpad: tilt to walk + push to shove, drag to walk + tap to shove", async ({ browser }) => {
  test.setTimeout(180_000);
  const { tv, code } = await sumoTv(browser);
  const m = await joinPhone(browser, code, "Meena", { "Motion Sumo": "motion" });
  const t = await joinPhone(browser, code, "Tara", { "Motion Sumo": "touchpad" });
  await startSumo(tv);
  await practiseUntilReady(tv, m, "Meena", ["push"]);
  const pad = t.locator(".game-pad .touchpad").first();
  await expect(pad).toBeVisible();
  const pb = (await pad.boundingBox())!;
  const px = pb.x + pb.width / 2, py = pb.y + pb.height / 2;
  const tap = async () => {
    await pad.dispatchEvent("pointerdown", { pointerId: 9, clientX: px, clientY: py }, { timeout: 2000 }).catch(() => undefined);
    await pad.dispatchEvent("pointerup", { pointerId: 9, clientX: px, clientY: py }, { timeout: 2000 }).catch(() => undefined);
  };
  const card = tv.locator('.tut-card[data-player="Tara"]');
  await expect(card).toContainText("✓", { timeout: 15_000 });
  await tap();
  await expect(card).toHaveClass(/ready/, { timeout: 10_000 });
  const bout = stateOf(tv);
  await expect.poll(async () => (await bout()).phase, { timeout: 15_000 }).toBe("fight");
  expect((await bout()).w).toHaveLength(4);

  const s0 = await bout();
  const m0 = s0.w.find((w) => w.name === "Meena")!, t0 = s0.w.find((w) => w.name === "Tara")!;
  let mMoved = 0, tMoved = 0, shot = false;
  const until = Date.now() + 60_000;
  for (let i = 0; Date.now() < until; i++) {
    const s = await bout();
    if (s.phase === "over") break;
    const am = aim(s, "Meena"), at = aim(s, "Tara");
    mMoved = Math.max(mMoved, Math.hypot(am.me.x - m0.x, am.me.y - m0.y));
    tMoved = Math.max(tMoved, Math.hypot(at.me.x - t0.x, at.me.y - t0.y));
    if (!am.me.out) {
      await pose(m, upright(am.x * 20, am.y * 20), 0);       // tilt towards the target
      if ((am.d < 120 && i % 4 === 0) || i % 10 === 3) await gesture(m, "push");
    }
    if (!at.me.out) {
      if (at.d < 110 || i % 10 === 1) await tap();
      else await pad.dispatchEvent("pointerdown", { pointerId: 9, clientX: px + at.x * pb.width * 0.4, clientY: py - at.y * pb.height * 0.4 }, { timeout: 2000 }).catch(() => undefined);
    }
    if (!shot && mMoved > 40 && tMoved > 40) {
      shot = true;
      await tv.screenshot({ path: "test-results/sumo-motion-touchpad.png" });
      await t.screenshot({ path: "test-results/sumo-touchpad-pad.png" });
    }
    await tv.waitForTimeout(100);
  }
  const end = await bout();
  const me = end.w.find((w) => w.name === "Meena")!, ta = end.w.find((w) => w.name === "Tara")!;
  expect(mMoved).toBeGreaterThan(40);
  expect(tMoved).toBeGreaterThan(40);
  expect(me.shoves).toBeGreaterThan(0);
  expect(ta.shoves).toBeGreaterThan(0);
  await expect.poll(async () => (await bout()).phase, { timeout: 40_000 }).toBe("over"); // the ring shrinks, so it always ends
});

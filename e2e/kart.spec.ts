import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

type KartDbg = {
  phase: string; time: number; finish: string[];
  karts: Array<{ id: string; name: string; cpu: boolean; lap: number; place: number; dist: number; speed: number; item: string | null; items: number; pickups: number; drifts: number; done: boolean; turn: number }>;
};

async function kartTv(browser: Browser, track: string) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto(`/tv?quick=1&track=${track}`);
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<KartDbg> => JSON.parse((await tv.locator("[data-kart]").getAttribute("data-kart")) || "{}");

/** Presses and keeps holding an on-screen hold button (a thumb resting on GAS). */
async function holdDown(page: Page, label: string, pointerId: number) {
  await page.locator(".game-pad .action", { hasText: label }).first().dispatchEvent("pointerdown", { pointerId });
}
async function arrow(page: Page, dir: "left" | "right", down: boolean) {
  await page.locator(`.game-pad .arrow-${dir}`).first().dispatchEvent(down ? "pointerdown" : "pointerup", { pointerId: 21 }, { timeout: 2000 }).catch(() => undefined); // the race may end (pad replaced) at any moment
}

async function startKart(tv: Page) {
  await tv.locator(".game-card", { hasText: "Kart Knockout" }).click();
  await tv.getByRole("button", { name: /Start Kart Knockout/ }).click();
}

test("Kart Knockout: two phones (hybrid wheel + buttons) race CPU karts round the track to the finish", async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await kartTv(browser, "oval");
  const a = await joinPhone(browser, code, "Ravi");                                   // hybrid, the default
  const b = await joinPhone(browser, code, "Divya", { "Kart Knockout": "buttons" });
  await startKart(tv);
  await practiseUntilReady(tv, a, "Ravi", ["btn:ITEM"]);
  await practiseUntilReady(tv, b, "Divya", ["btn:ITEM"]);
  const race = stateOf(tv);
  await expect.poll(async () => (await race()).karts?.length ?? 0, { timeout: 15_000 }).toBe(4); // 2 people + 2 CPU karts
  await expect(a.locator('.game-pad[data-mode="hybrid"] .action')).toHaveCount(3);
  await expect(b.locator('.game-pad[data-mode="buttons"] .arrow-left')).toBeVisible();
  const first = await race();
  const ravi = first.karts.find((k) => k.name === "Ravi")!.id, divya = first.karts.find((k) => k.name === "Divya")!.id;
  await expect.poll(async () => (await race()).phase, { timeout: 10_000 }).toBe("race");
  await holdDown(a, "GAS", 11);
  await holdDown(b, "GAS", 12);

  // drive: Ravi turns his phone like a wheel, Divya taps ◀ ▶, both towards the road ahead
  let steerB: "left" | "right" | null = null;
  let shot = false, usedItem = false;
  const places = new Set<string>();
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const s = await race();
    if (s.phase === "done") break;
    const ka = s.karts.find((k) => k.id === ravi)!, kb = s.karts.find((k) => k.id === divya)!;
    places.add(s.karts.map((k) => k.place).join(""));
    if (!ka.done) await pose(a, upright(Math.max(-30, Math.min(30, ka.turn * 60)), 0), 0);
    const want = kb.turn > 0.12 ? "right" : kb.turn < -0.12 ? "left" : null;
    if (want !== steerB) {
      if (steerB) await arrow(b, steerB, false);
      if (want) await arrow(b, want, true);
      steerB = want;
    }
    if (kb.item && !usedItem) {
      await press(b, "ITEM").catch(() => undefined);
      usedItem = true;
    }
    if (!shot && ka.dist > 500 && kb.dist > 300) {
      shot = true;
      await tv.screenshot({ path: "test-results/kart-race.png" });
      await a.screenshot({ path: "test-results/kart-pad-hybrid.png" });
    }
    await tv.waitForTimeout(80);
  }
  const end = await race();
  expect(shot).toBe(true);
  expect(end.phase).toBe("done");
  expect(end.finish.length).toBeGreaterThanOrEqual(1);
  // both people really drove: most of the way round the 1763 px lap at least (usually one of them finishes)
  const humans = end.karts.filter((k) => !k.cpu);
  expect(humans.some((k) => k.done || k.dist > 1400)).toBe(true);
  expect(Math.min(...humans.map((k) => k.dist))).toBeGreaterThan(900);
  expect(places.size).toBeGreaterThan(1);               // positions changed during the race
  expect(end.karts.reduce((n, k) => n + k.pickups, 0)).toBeGreaterThan(0);
  await tv.screenshot({ path: "test-results/kart-finish.png" });
  await expect(a.getByText(/You won the race!|You finished/)).toBeVisible({ timeout: 10_000 });
  await expect(b.getByText(/You won the race!|You finished/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Kart Knockout with motion: turn to steer, gas is automatic, push uses the item, flick drifts", async ({ browser }) => {
  test.setTimeout(180_000);
  const { tv, code } = await kartTv(browser, "grove");
  const p = await joinPhone(browser, code, "Meena", { "Kart Knockout": "motion" });
  await startKart(tv);
  await practiseUntilReady(tv, p, "Meena", ["push"]);
  const race = stateOf(tv);
  await expect.poll(async () => (await race()).phase, { timeout: 15_000 }).toBe("race");
  let flicked = false, pushed = false;
  const until = Date.now() + 100_000;
  while (Date.now() < until) {
    const s = await race();
    if (s.phase === "done") break;
    const me = s.karts.find((k) => !k.cpu)!;
    if (me.done) break;
    await pose(p, upright(Math.max(-30, Math.min(30, me.turn * 60)), 0), 0);
    if (me.item && !pushed) { await gesture(p, "push"); pushed = true; }
    if (!flicked && me.dist > 300 && Math.abs(me.turn) > 0.25) { await gesture(p, me.turn > 0 ? "flick-right" : "flick-left"); flicked = true; }
    await tv.waitForTimeout(80);
  }
  const me = (await race()).karts.find((k) => !k.cpu)!;
  expect(me.dist).toBeGreaterThan(700);                 // drove well round the lap with no buttons at all
  if (pushed) expect(me.items).toBeGreaterThan(0);
  await tv.screenshot({ path: "test-results/kart-motion.png" });
});

test("Kart Knockout on Harbour Hairpins: the CPU karts get going and the buttons player steers with ◀ ▶", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await kartTv(browser, "harbour");
  const p = await joinPhone(browser, code, "Arun", { "Kart Knockout": "buttons" });
  await startKart(tv);
  await practiseUntilReady(tv, p, "Arun", ["btn:ITEM"]);
  const race = stateOf(tv);
  await expect.poll(async () => (await race()).phase, { timeout: 15_000 }).toBe("race");
  await holdDown(p, "GAS", 13);
  for (let i = 0; i < 40; i++) {
    const me = (await race()).karts.find((k) => !k.cpu)!;
    const dir = me.turn > 0 ? "right" : "left";
    await arrow(p, dir, true);
    await tv.waitForTimeout(Math.min(250, Math.abs(me.turn) * 400));
    await arrow(p, dir, false);
    await tv.waitForTimeout(60);
  }
  const s = await race();
  expect(s.karts.filter((k) => k.cpu).every((k) => k.dist > 500)).toBe(true);
  expect(s.karts.find((k) => !k.cpu)!.dist).toBeGreaterThan(300);
  await tv.screenshot({ path: "test-results/kart-harbour.png" });
});

import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

type Racer = { id: string; name: string; cpu: boolean; kind: string; place: number; lap: number; s: number; d: number; v: number; meter: number; item: string | null; drift: number; wrecked: boolean; done: boolean; turn: number; stats: Record<string, number>; got: { boost: number; item: number; drift: number } | null };
type Dbg = { phase: string; time: number; fps: number; calls: number; tris: number; tier: string; views: number; laps: number; length: number; finish: string[]; replay: boolean; racers: Racer[] };

/** A GPU-backed TV page (Apple Metal on the dev machine) that records CSP violations. */
async function ghatTv(browser: Browser, quality?: string) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await tv.goto(`/tv?quick=1${quality ? `&quality=${quality}` : ""}`);
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<Dbg> => JSON.parse((await tv.locator("[data-ghat]").getAttribute("data-ghat").catch(() => "")) || "{}");
const csp = (tv: Page) => tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

async function startGhat(tv: Page) {
  await tv.locator(".game-card", { hasText: "GHAT RUSH" }).click();
  await tv.getByRole("button", { name: /Start GHAT RUSH/ }).click();
}
async function arrow(page: Page, dir: "left" | "right", down: boolean) {
  await page.locator(`.game-pad .arrow-${dir}`).first().dispatchEvent(down ? "pointerdown" : "pointerup", { pointerId: 21 }, { timeout: 2000 }).catch(() => undefined);
}
async function driftButton(page: Page, down: boolean) {
  await page.locator(".game-pad .action", { hasText: "DRIFT" }).first().dispatchEvent(down ? "pointerdown" : "pointerup", { pointerId: 31 }, { timeout: 2000 }).catch(() => undefined);
}

test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });

test("GHAT RUSH: two phones (hybrid wheel + buttons) race the quick ghat to the podium, no CSP violations", async ({ browser }) => {
  test.setTimeout(300_000);
  const { tv, code } = await ghatTv(browser);
  const a = await joinPhone(browser, code, "Asha");                                // hybrid, the default
  const b = await joinPhone(browser, code, "Ravi", { "GHAT RUSH": "buttons" });
  await startGhat(tv);
  await practiseUntilReady(tv, a, "Asha", ["btn:BOOST"]);
  await practiseUntilReady(tv, b, "Ravi", ["btn:BOOST"]);
  const race = stateOf(tv);
  await expect.poll(async () => (await race()).racers?.length ?? 0, { timeout: 60_000 }).toBe(6); // 2 people + 4 CPUs
  await expect(a.locator('.game-pad[data-mode="hybrid"] .action')).toHaveCount(3);
  await expect(b.locator('.game-pad[data-mode="buttons"] .arrow-left')).toBeVisible();
  expect((await race()).views).toBe(2);                                                 // split screen
  await expect.poll(async () => (await race()).phase, { timeout: 30_000 }).toMatch(/intro|countdown/);
  await tv.screenshot({ path: "test-results/ghat-intro.png" });
  await expect.poll(async () => (await race()).phase, { timeout: 20_000 }).toBe("race");

  let steerB: "left" | "right" | null = null, drifting = false, shot = false, usedItem = false, boosted = false, boostedB = false;
  const fps: number[] = [];
  const until = Date.now() + 150_000;
  while (Date.now() < until) {
    const s = await race();
    if (s.phase !== "race") break;
    fps.push(s.fps);
    const ra = s.racers.find((r) => r.name === "Asha")!, rb = s.racers.find((r) => r.name === "Ravi")!;
    // Asha: turns the phone like a wheel, holds DRIFT through the tight bends
    if (!ra.done) await pose(a, upright(Math.max(-30, Math.min(30, ra.turn * 35)), 0), 0);
    const tight = Math.abs(ra.turn) > 0.45 && ra.v > 18;
    if (tight !== drifting) { await driftButton(a, tight); drifting = tight; }
    if (!boosted && ra.meter >= 0.34 && Math.abs(ra.turn) < 0.2) { await press(a, "BOOST").catch(() => undefined); boosted = true; }
    // Ravi: taps ◀ ▶ towards the road ahead, uses whatever item he gets
    const want = rb.turn > 0.15 ? "right" : rb.turn < -0.15 ? "left" : null;
    if (want !== steerB) {
      if (steerB) await arrow(b, steerB, false);
      if (want) await arrow(b, want, true);
      steerB = want;
    }
    if (rb.item && !usedItem) { await press(b, "ITEM").catch(() => undefined); usedItem = true; }
    if (!boostedB && rb.meter >= 0.34 && rb.s > 100) { await press(b, "BOOST").catch(() => undefined); boostedB = true; }
    if (!shot && ra.s > 350) {
      shot = true;
      await tv.screenshot({ path: "test-results/ghat-race-split.png" });
      await a.screenshot({ path: "test-results/ghat-pad-hybrid.png" });
    }
    await tv.waitForTimeout(80);
  }
  await expect.poll(async () => (await race()).phase, { timeout: 30_000 }).toMatch(/results|replay|podium/);
  const end = await race();
  expect(shot).toBe(true);
  expect(end.finish).toHaveLength(6);
  const humans = end.racers.filter((r) => !r.cpu);
  // both people really drove: most of the lap at least, and the phones' buttons arrived
  expect(Math.min(...humans.map((r) => r.s))).toBeGreaterThan(end.length * 0.6);
  expect(humans.find((r) => r.name === "Asha")!.got!.drift).toBeGreaterThan(0);
  expect(humans.find((r) => r.name === "Ravi")!.got!.boost).toBeGreaterThan(0);
  expect(end.racers.reduce((n, r) => n + r.stats.turbos, 0)).toBeGreaterThan(0);  // mini-turbos fired
  await tv.screenshot({ path: "test-results/ghat-results.png" });
  if (end.replay) {
    await expect.poll(async () => (await race()).phase, { timeout: 20_000 }).toBe("replay");
    await tv.screenshot({ path: "test-results/ghat-replay.png" });
  }
  await expect.poll(async () => (await race()).phase, { timeout: 30_000 }).toBe("podium");
  await tv.waitForTimeout(1500);
  await tv.screenshot({ path: "test-results/ghat-podium.png" });
  await expect(a.getByText(/You rule the ghat!|You finished/)).toBeVisible({ timeout: 20_000 });
  await expect(b.getByText(/You rule the ghat!|You finished/)).toBeVisible({ timeout: 20_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 30_000 });
  expect(await csp(tv)).toEqual([]);
  console.log(`GHAT RUSH split-screen: median fps ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}, calls ${end.calls}, tris ${end.tris}, tier ${end.tier}`);
});

test("GHAT RUSH with motion: tilt to steer, flick to drift, push to boost (auto-gas)", async ({ browser }) => {
  test.setTimeout(180_000);
  const { tv, code } = await ghatTv(browser);
  const p = await joinPhone(browser, code, "Meena", { "GHAT RUSH": "motion" });
  await startGhat(tv);
  await practiseUntilReady(tv, p, "Meena", ["push"]);
  const race = stateOf(tv);
  await expect.poll(async () => (await race()).phase, { timeout: 60_000 }).toBe("race");
  let flicked = false, pushed = false;
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    const s = await race();
    if (s.phase !== "race") break;
    const me = s.racers.find((r) => !r.cpu)!;
    await pose(p, upright(Math.max(-30, Math.min(30, me.turn * 35)), 0), 0);
    if (!pushed && me.meter >= 0.34 && me.s > 60) { await gesture(p, "push"); pushed = true; }
    if (!flicked && me.s > 150 && Math.abs(me.turn) > 0.3) { await gesture(p, me.turn > 0 ? "flick-right" : "flick-left"); flicked = true; }
    await tv.waitForTimeout(80);
  }
  const me = (await race()).racers.find((r) => !r.cpu)!;
  expect(me.s).toBeGreaterThan(500);                    // drove a third of the lap with no buttons at all
  expect(me.got!.boost).toBeGreaterThan(0);
  if (flicked) expect(me.got!.drift).toBeGreaterThan(0);
  await tv.screenshot({ path: "test-results/ghat-motion.png" });
  expect(await csp(tv)).toEqual([]);
});

for (const quality of ["lite", "high", "ultra"] as const) {
  test(`GHAT RUSH looks right on the ${quality} tier (screenshot, frame rate, draw calls)`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { tv, code } = await ghatTv(browser, quality);
    const p = await joinPhone(browser, code, "Asha");
    await startGhat(tv);
    await practiseUntilReady(tv, p, "Asha", ["btn:BOOST"]);
    const race = stateOf(tv);
    await expect.poll(async () => (await race()).phase, { timeout: 60_000 }).toBe("race");
    expect((await race()).tier).toBe(quality);
    const fps: number[] = [];
    const until = Date.now() + 14_000;
    while (Date.now() < until) {
      const s = await race();
      const me = s.racers.find((r) => !r.cpu)!;
      await pose(p, upright(Math.max(-30, Math.min(30, me.turn * 35)), 0), 0);
      fps.push(s.fps);
      await tv.waitForTimeout(100);
    }
    const s = await race();
    await tv.screenshot({ path: `test-results/ghat-${quality}.png` });
    expect(s.calls).toBeGreaterThan(5);
    if (quality === "lite") expect(s.calls).toBeLessThan(120);
    expect(await csp(tv)).toEqual([]);
    console.log(`GHAT RUSH ${quality}: median fps ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}, draw calls ${s.calls}, triangles ${s.tris}`);
  });
}

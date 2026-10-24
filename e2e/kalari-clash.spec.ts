import { expect, test, type Browser, type Page } from "@playwright/test";
import { holdAction, joinPhone, practiseUntilReady, press, swipe, tvCode, padMove } from "./helpers";

type P = { id: string; name: string; char: string; cpu: boolean; x: number; z: number; alive: boolean; state: string; health: number; meter: number; wins: number; kos: number; ringouts: number; falls: number; hits: number; blocks: number; parries: number; rolls: number; specials: number; got: Record<string, number> | null };
type Dbg = { phase: string; round: number; left: number; fps: number; calls: number; tris: number; tier: string; arena: string; players: P[] };

async function kalariTv(browser: Browser, query: string) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await tv.goto(`/tv?quick=1&${query}`);
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<Dbg> => JSON.parse((await tv.locator("[data-kalari]").getAttribute("data-kalari").catch(() => "")) || "{}");

async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Kalari Clash" }).click();
  await tv.getByRole("button", { name: /Start Kalari Clash/ }).click();
}

/** Practise GUARD (hold) and STRIKE on a buttons phone until the get-ready screen lets go. */
async function ready(tv: Page, phone: Page, name: string) {
  await holdAction(phone, "GUARD", 250).catch(() => undefined);
  // in quick mode the get-ready screen can hand over to character select mid-check: that is fine too
  await practiseUntilReady(tv, phone, name, ["btn:STRIKE"]).catch(async (e) => {
    if (!(await tv.locator("[data-kalari-select]").count())) throw e;
  });
}

/** A thumb on the joystick: pointerdown once, then pointermoves towards a direction (x right, y up). */
async function thumb(phone: Page) {
  const stick = phone.locator(".game-pad .stick").first();
  const box = (await stick.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) / 2;
  await stick.dispatchEvent("pointerdown", { pointerId: 5, clientX: cx, clientY: cy });
  return (x: number, y: number) =>
    stick.dispatchEvent("pointermove", { pointerId: 5, clientX: cx + x * r * 0.9, clientY: cy - y * r * 0.9 }, { timeout: 2000 }).catch(() => undefined);
}

function aim(s: Dbg, name: string) {
  const me = s.players.find((p) => p.name === name)!;
  let best: P | null = null, bd = Infinity;
  for (const p of s.players) {
    if (p === me || !p.alive) continue;
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return { me, x: 0, y: 0, d: Infinity };
  return { me, x: (best.x - me.x) / bd, y: -(best.z - me.z) / bd, d: bd };
}

const TIER = process.env.KALARI_TIER ?? "lite";
// The high/ultra tiers need a real GPU: headless Chromium falls back to software GL (SwiftShader, about 1 fps at
// 1080p with shadows and bloom). KALARI_GPU=1 asks Chromium for the machine's GPU (ANGLE on Metal on a Mac).
if (process.env.KALARI_GPU) test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });

test(`Kalari Clash with buttons (${TIER}): two phones and two CPUs fight a best of three to the podium`, async ({ browser }) => {
  test.setTimeout(300_000);
  const { tv, code } = await kalariTv(browser, `quality=${TIER}&arena=courtyard`);
  const a = await joinPhone(browser, code, "Asha");
  const b = await joinPhone(browser, code, "Ravi");
  await start(tv);
  await ready(tv, a, "Asha");
  await ready(tv, b, "Ravi");
  // character select: Asha moves one fighter right and locks in; Ravi locks in where he is
  await expect(tv.locator("[data-kalari-select]")).toBeVisible({ timeout: 15_000 });
  await tv.screenshot({ path: `test-results/kalari-select-${TIER}.png` });
  const moveA = await thumb(a);
  await moveA(1, 0);
  await a.waitForTimeout(250);
  await moveA(0, 0);
  await press(a, "STRIKE");
  await press(b, "STRIKE");
  const k = stateOf(tv);
  await expect.poll(async () => (await k()).players?.length ?? 0, { timeout: 30_000 }).toBe(4);
  await expect(a.locator('.game-pad[data-mode="buttons"] .stick')).toBeVisible();
  for (const label of ["STRIKE", "HEAVY", "GUARD", "ROLL", "SPECIAL"]) await expect(a.locator(".game-pad .action", { hasText: label })).toBeVisible();
  await expect.poll(async () => (await k()).phase, { timeout: 30_000 }).toBe("fight");
  await a.screenshot({ path: "test-results/kalari-pad-buttons.png" });

  const fps: number[] = [];
  const shots = new Set<string>();
  let n = 0;
  const until = Date.now() + 200_000;
  while (Date.now() < until) {
    const s = await k();
    if (s.phase === "podium") break;
    if (s.phase === "fight") {
      fps.push(s.fps);
      const t = aim(s, "Asha");
      if (t.me.alive) {
        await moveA(t.x, t.y);
        if (t.d < 2.6) {
          if (t.me.meter >= 100) await press(a, "SPECIAL").catch(() => undefined);
          else if (n % 5 === 3) await press(a, "HEAVY").catch(() => undefined);
          else for (let i = 0; i < 3; i++) await press(a, "STRIKE").catch(() => undefined); // tap-tap-tap
        }
      }
      const u = aim(s, "Ravi");
      if (u.me.alive) {
        if (n % 7 === 2) await holdAction(b, "GUARD", 300).catch(() => undefined);
        else if (n % 9 === 5) await press(b, "ROLL").catch(() => undefined);
        else if (u.d < 2) await press(b, u.me.meter >= 100 ? "SPECIAL" : "STRIKE").catch(() => undefined);
      }
      if (!shots.has("fight") && s.players.some((p) => p.hits > 2) && s.players.every((p) => p.alive)) {
        shots.add("fight");
        await tv.screenshot({ path: `test-results/kalari-fight-${TIER}.png` });
      }
    }
    if (s.phase === "intro" && !shots.has("intro")) {
      shots.add("intro");
      await tv.screenshot({ path: `test-results/kalari-intro-${TIER}.png` });
    }
    n++;
    await tv.waitForTimeout(50);
  }
  const end = await k();
  expect(end.phase).toBe("podium");
  await expect(tv.locator("[data-award]").first()).toBeVisible({ timeout: 5000 });
  await tv.waitForTimeout(1600);
  await tv.screenshot({ path: `test-results/kalari-podium-${TIER}.png` });
  const asha = end.players.find((p) => p.name === "Asha")!, ravi = end.players.find((p) => p.name === "Ravi")!;
  expect(asha.got!.strike).toBeGreaterThan(5);        // STRIKE taps reached the TV
  expect(asha.hits + ravi.hits).toBeGreaterThan(0);   // and the people landed some
  expect(ravi.got!.guard + ravi.got!.roll + ravi.got!.strike).toBeGreaterThan(3);
  expect(end.players.reduce((s, p) => s + p.wins, 0)).toBeGreaterThanOrEqual(2);
  expect(end.players.reduce((s, p) => s + p.kos + p.falls, 0)).toBeGreaterThanOrEqual(2);
  console.log(`kalari ${TIER}: fps min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}; draw calls ${end.calls}, triangles ${end.tris}`);
  await expect(a.getByText(/Kalari Champion!|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(b.getByText(/Kalari Champion!|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 20_000 });
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test("Kalari Clash with the touchpad: drag to move, tap to strike, swipe to roll", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await kalariTv(browser, "quality=lite&arena=docks");
  const p = await joinPhone(browser, code, "Meena", { "Kalari Clash": "touchpad" });
  await start(tv);
  await holdAction(p, "GUARD", 250).catch(() => undefined);
  await practiseUntilReady(tv, p, "Meena", ["pad:tap"]);
  await expect(tv.locator("[data-kalari-select]")).toBeVisible({ timeout: 15_000 });
  await padMove(p, "tap"); // lock in
  const k = stateOf(tv);
  await expect.poll(async () => (await k()).phase, { timeout: 30_000 }).toBe("fight");
  await expect(p.locator('.game-pad[data-mode="touchpad"] .touchpad')).toBeVisible();
  const start0 = (await k()).players.find((x) => x.name === "Meena")!;
  await swipe(p, { x: -0.6, y: 0 }, { x: 0.6, y: 0 }, 150);
  await p.waitForTimeout(700);
  await swipe(p, { x: 0, y: 0 }, { x: start0.x > 0 ? -0.8 : 0.8, y: 0 }, 900);
  for (let i = 0; i < 6; i++) {
    await padMove(p, "tap");
    await p.waitForTimeout(300);
  }
  const me = (await k()).players.find((x) => x.name === "Meena")!;
  expect(me.got!.strike).toBeGreaterThanOrEqual(5);
  expect(me.got!.roll).toBeGreaterThanOrEqual(1);
  if (me.alive) expect(me.rolls).toBeGreaterThanOrEqual(1);
  expect(Math.hypot(me.x - start0.x, me.z - start0.z)).toBeGreaterThan(0.5);
  await tv.screenshot({ path: "test-results/kalari-touchpad-docks.png" });
  await p.screenshot({ path: "test-results/kalari-pad-touchpad.png" });
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

for (const tier of ["lite", "high", "ultra"] as const) {
  for (const arena of ["courtyard", "docks", "rooftop"] as const) {
    test(`Kalari Clash renders the ${arena} in the ${tier} tier`, async ({ browser }) => {
      test.skip(!process.env.KALARI_SHOTS, "screenshots for review: KALARI_SHOTS=1");
      test.setTimeout(90_000);
      const { tv, code } = await kalariTv(browser, `quality=${tier}&arena=${arena}`);
      const a = await joinPhone(browser, code, "Asha");
      await start(tv);
      await ready(tv, a, "Asha");
      await expect(tv.locator("[data-kalari-select]")).toBeVisible({ timeout: 15_000 });
      await press(a, "STRIKE");
      const k = stateOf(tv);
      for (let i = 0; i < 4 && process.env.KALARI_DEBUG; i++) { await tv.waitForTimeout(3000); const d = await k(); console.log(d.phase, d.fps, d.calls, JSON.stringify(d.players?.map((p) => [p.name, p.x, p.z, p.alive, p.state, p.health]))); }
      await expect.poll(async () => (await k()).phase, { timeout: 40_000 }).toBe("fight");
      await tv.waitForTimeout(5000);
      const s = await k();
      console.log(`kalari ${tier} ${arena}: fps ${s.fps}, draw calls ${s.calls}, triangles ${s.tris}`);
      await tv.screenshot({ path: `test-results/kalari-${tier}-${arena}.png` });
      expect(s.tier).toBe(tier);
      expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    });
  }
}

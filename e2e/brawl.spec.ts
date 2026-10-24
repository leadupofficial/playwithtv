import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { gesture, holdAction, joinPhone, padMove, practiseUntilReady, press, swipe, tvCode } from "./helpers";

type Fighter = { id: string; name: string; cpu: boolean; x: number; z: number; alive: boolean; state: string; damage: number; wins: number; kos: number; hits: number; swings: number; dodges: number; hazards: number; falls: number; score: number; got: { swing: number; smash: number; dodge: number; hold: number } | null };
type BrawlDbg = { phase: string; round: number; left: number; fps: number; calls: number; tris: number; chaos: string | null; winner: string | null; players: Fighter[] };

async function brawlTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  // the 3D assets (GLB with embedded textures → blob: images) and sounds must load under the CSP
  await tv.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<BrawlDbg> => JSON.parse((await tv.locator("[data-brawl]").getAttribute("data-brawl").catch(() => "")) || "{}");

async function startBrawl(tv: Page) {
  await tv.locator(".game-card", { hasText: "Pillow Fort Brawl" }).click();
  await tv.getByRole("button", { name: /Start Pillow Fort Brawl/ }).click();
}

/** The nearest fighter still on the bed, as a unit direction in stick axes (x right, y up = away from the TV). */
function aim(s: BrawlDbg, name: string) {
  const me = s.players.find((p) => p.name === name)!;
  let best: Fighter | null = null, bd = Infinity;
  for (const p of s.players) {
    if (p === me || !p.alive) continue;
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return { me, x: 0, y: 0, d: Infinity };
  return { me, x: (best.x - me.x) / bd, y: -(best.z - me.z) / bd, d: bd };
}

/** A thumb on the joystick: pointerdown once, then pointermoves towards a direction. */
async function thumb(phone: Page) {
  const stick = phone.locator(".game-pad .stick").first();
  const box = (await stick.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) / 2;
  await stick.dispatchEvent("pointerdown", { pointerId: 5, clientX: cx, clientY: cy });
  return (x: number, y: number) =>
    stick.dispatchEvent("pointermove", { pointerId: 5, clientX: cx + x * r * 0.9, clientY: cy - y * r * 0.9 }, { timeout: 2000 }).catch(() => undefined);
}

async function shoot(target: Page | Locator, path: string) {
  await target.screenshot({ path });
}

test("Pillow Fort Brawl with buttons (the default): two phones and CPUs play a whole best-of-three to the podium", async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await brawlTv(browser);
  const a = await joinPhone(browser, code, "Asha");
  const b = await joinPhone(browser, code, "Ravi");
  await startBrawl(tv);
  for (const [p, n] of [[a, "Asha"], [b, "Ravi"]] as const) {
    await holdAction(p, "SWING", 300).catch(() => undefined); // hold-to-charge counts as practising SWING
    await practiseUntilReady(tv, p, n, ["btn:DODGE"]);
  }
  const brawl = stateOf(tv);
  await expect.poll(async () => (await brawl()).players?.length ?? 0, { timeout: 20_000 }).toBe(4); // 2 people + 2 CPUs
  await expect(a.locator('.game-pad[data-mode="buttons"] .stick')).toBeVisible();
  await expect(a.locator(".game-pad .action", { hasText: "SWING" })).toBeVisible();
  await expect(a.locator(".game-pad .action", { hasText: "DODGE" })).toBeVisible();
  await expect.poll(async () => (await brawl()).phase, { timeout: 20_000 }).toBe("fight");
  await shoot(a, "test-results/brawl-pad-buttons.png");

  const moveA = await thumb(a);
  const shots = { fight: false, ghost: false };
  const fps: number[] = [];
  let n = 0;
  const until = Date.now() + 150_000;
  while (Date.now() < until) {
    const s = await brawl();
    if (s.phase === "podium") break;
    if (s.phase === "fight") {
      fps.push(s.fps);
      const t = aim(s, "Asha");
      if (t.me.alive) {
        await moveA(t.x, t.y);
        if (t.d < 2.2) await holdAction(a, "SWING", n % 3 === 0 ? 650 : 200).catch(() => undefined); // mix taps and charged smashes
      } else {
        await moveA(t.x, t.y); // as a ghost: float over someone and drop a sock or feathers
        if (t.d < 1.5) await holdAction(a, "SWING", 80).catch(() => undefined);
      }
      if (n % 9 === 4) await press(b, "DODGE").catch(() => undefined);
      if (n % 5 === 1) await holdAction(b, "SWING", 150).catch(() => undefined);
      if (!shots.fight && s.players.some((p) => p.hits > 0) && s.players.every((p) => p.alive)) {
        shots.fight = true;
        await shoot(tv, "test-results/brawl-fight.png");
      }
      if (!shots.ghost && s.players.some((p) => p.state === "ghost") && s.players.filter((p) => p.alive).length >= 2) {
        shots.ghost = true;
        await shoot(tv, "test-results/brawl-ghost.png");
      }
    }
    n++;
    await tv.waitForTimeout(60);
  }
  const end = await brawl();
  expect(end.phase).toBe("podium");
  await expect(tv.locator("[data-award]").first()).toBeVisible({ timeout: 4000 });
  await tv.waitForTimeout(1500); // the award cards pop in one by one
  await shoot(tv, "test-results/brawl-podium.png");
  const asha = end.players.find((p) => p.name === "Asha")!, ravi = end.players.find((p) => p.name === "Ravi")!;
  expect(asha.got!.hold).toBeGreaterThan(3);           // SWING presses reached the TV
  expect(asha.swings).toBeGreaterThan(2);              // and the hold-to-charge button swung the pillow
  expect(ravi.got!.hold + ravi.got!.dodge).toBeGreaterThan(2);  // the second phone's SWING and DODGE reached the TV
  expect(end.players.reduce((k, p) => k + p.falls, 0)).toBeGreaterThanOrEqual(3); // ring-outs every round
  expect(end.players.reduce((k, p) => k + p.wins, 0)).toBeGreaterThanOrEqual(2);
  expect(end.calls).toBeLessThan(110);                 // draw-call budget for TV GPUs
  console.log(`brawl fps during play: min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}; draw calls ${end.calls}, triangles ${end.tris}`);
  await expect(a.getByText(/Pillow Champion!|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(b.getByText(/Pillow Champion!|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 20_000 });
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test("Pillow Fort Brawl with the touchpad: drag to move, tap to swing, swipe to dodge", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await brawlTv(browser);
  const p = await joinPhone(browser, code, "Meena", { "Pillow Fort Brawl": "touchpad" });
  await startBrawl(tv);
  await practiseUntilReady(tv, p, "Meena", ["pad:tap", "pad:swipe-left"]);
  const brawl = stateOf(tv);
  await expect.poll(async () => (await brawl()).phase, { timeout: 20_000 }).toBe("fight");
  await expect(p.locator('.game-pad[data-mode="touchpad"] .touchpad')).toBeVisible();
  const start = (await brawl()).players.find((x) => x.name === "Meena")!;
  // dodge first, before a CPU can reach us (two quick swipes, a dodge cooldown apart)
  await swipe(p, { x: -0.6, y: 0 }, { x: 0.6, y: 0 }, 150);
  await p.waitForTimeout(1000);
  await swipe(p, { x: 0, y: -0.6 }, { x: 0, y: 0.6 }, 150);
  // drag towards the middle of the bed for a moment (finger position = movement)
  await swipe(p, { x: 0, y: 0 }, { x: start.x > 0 ? -0.8 : 0.8, y: 0 }, 900);
  for (let i = 0; i < 6; i++) {
    await padMove(p, "tap");
    await p.waitForTimeout(450);
  }
  const s = await brawl();
  const me = s.players.find((x) => x.name === "Meena")!;
  // the TV got the touchpad's taps as swings and its swipes as dodges
  expect(me.got!.swing).toBeGreaterThanOrEqual(5);
  expect(me.got!.dodge).toBeGreaterThanOrEqual(2);
  // and they did something: swings (or, once knocked into the lava, ghost hazards) and a dodge (if still on the bed)
  if (me.falls === 0) {
    expect(me.swings).toBeGreaterThanOrEqual(1);
    expect(me.dodges).toBeGreaterThanOrEqual(1);
  }
  expect(Math.hypot(me.x - start.x, me.z - start.z)).toBeGreaterThan(0.5);
  await shoot(tv, "test-results/brawl-touchpad.png");
  await shoot(p, "test-results/brawl-pad-touchpad.png");
});

test("Pillow Fort Brawl with motion: push to swing, a hard push smashes, flick to dodge", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await brawlTv(browser);
  const p = await joinPhone(browser, code, "Kavin", { "Pillow Fort Brawl": "motion" });
  await startBrawl(tv);
  await practiseUntilReady(tv, p, "Kavin", ["push", "flick-left"]);
  const brawl = stateOf(tv);
  await expect.poll(async () => (await brawl()).phase, { timeout: 20_000 }).toBe("fight");
  await gesture(p, "flick-right");                      // dodge first, before a CPU can reach us
  for (let i = 0; i < 4; i++) await gesture(p, "push", i === 3 ? 34 : 18);
  const me = (await brawl()).players.find((x) => x.name === "Kavin")!;
  // pushes arrive as swings, the hard push as a SMASH, the flick as a dodge
  expect(me.got!.swing + me.got!.smash).toBeGreaterThanOrEqual(3);
  expect(me.got!.smash).toBeGreaterThanOrEqual(1);
  expect(me.got!.dodge).toBeGreaterThanOrEqual(1);
  if (me.falls === 0) expect(me.swings).toBeGreaterThanOrEqual(1);
  await shoot(tv, "test-results/brawl-motion.png");
});

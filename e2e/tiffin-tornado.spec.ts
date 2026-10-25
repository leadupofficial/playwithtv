import { expect, test, type Browser, type Page } from "@playwright/test";
import { joinPhone, padTap, practiseUntilReady, swipe, tvCode } from "./helpers";

type Chef = { id: string; name: string; x: number; z: number; holding: string | null; verb: string; serves: number; points: number; got: { act: number; dash: number; work: number } };
type Tile = { code: string; c: number; r: number; item: string | null; stock: number; fire: boolean };
type Dbg = { phase: string; level: number; t: number; seconds: number; points: number; team: number; fps: number; calls: number; tris: number; tier: string; doors: boolean;
  orders: Array<{ recipe: string }>; chefs: Chef[]; tiles: Tile[]; cols: number; rows: number; layout: string[]; results: Array<{ level: number; points: number; stars: number; served: number }> };

async function tiffinTv(browser: Browser, quality = "lite") {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await tv.goto(`/tv?quick=1&quality=${quality}`);
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<Dbg> => JSON.parse((await tv.locator("[data-tiffin]").getAttribute("data-tiffin").catch(() => "")) || "{}");

async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Tiffin Tornado" }).click();
  await tv.getByRole("button", { name: /Start Tiffin Tornado/ }).click();
}

/** A thumb resting on the joystick: returns a function that pushes it towards (x, y) (stick axes, y up = away from the TV). */
async function thumb(phone: Page) {
  const stick = phone.locator(".game-pad .stick").first();
  const box = (await stick.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) / 2;
  await stick.dispatchEvent("pointerdown", { pointerId: 5, clientX: cx, clientY: cy });
  return (x: number, y: number) => stick.dispatchEvent("pointermove", { pointerId: 5, clientX: cx + x * r * 0.9, clientY: cy - y * r * 0.9 }, { timeout: 2000 }).catch(() => undefined);
}
const action = (phone: Page) => phone.locator(".game-pad .action").first().dispatchEvent("pointerdown", {}, { timeout: 3000 }).catch(() => undefined);

/** Next step (stick direction in game x/z) towards standing beside tile (tc, tr) and facing it; null = there. */
function steer(s: Dbg, me: Chef, tc: number, tr: number): { x: number; z: number } | null {
  const W = s.cols, H = s.rows, L = s.layout;
  const walk = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H && (L[r]![c] === "." || (L[r]![c] === "|" && !s.doors));
  const cx = (c: number) => c - (W - 1) / 2, cz = (r: number) => r - (H - 1) / 2;
  const at = { c: Math.round(me.x + (W - 1) / 2), r: Math.round(me.z + (H - 1) / 2) };
  const goals = new Set([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => walk(tc + dc!, tr + dr!)).map(([dc, dr]) => (tr + dr!) * W + tc + dc!));
  const prev = new Map<number, number>([[at.r * W + at.c, -1]]);
  const q = [at.r * W + at.c];
  let end = -1;
  while (q.length) {
    const k = q.shift()!;
    if (goals.has(k)) { end = k; break; }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = (k % W) + dc, r = Math.floor(k / W) + dr, n = r * W + c;
      if (walk(c, r) && !prev.has(n)) { prev.set(n, k); q.push(n); }
    }
  }
  if (end < 0) return { x: 0, z: 0 };
  const path: number[] = [];
  for (let n = end; n !== -1; n = prev.get(n)!) path.unshift(n);
  if (path.length > 1) {
    const nx = path[1]! % W, nr = Math.floor(path[1]! / W);
    const dx = cx(nx) - me.x, dz = cz(nr) - me.z, d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }
  // in the cell beside it: centre up, then lean towards the station to face it
  const ex = cx(end % W) - me.x, ez = cz(Math.floor(end / W)) - me.z;
  if (Math.hypot(ex, ez) > 0.3) return { x: ex * 1.4, z: ez * 1.4 };
  const fx = cx(tc) - me.x, fz = cz(tr) - me.z, d = Math.hypot(fx, fz) || 1;
  return { x: (fx / d) * 0.35, z: (fz / d) * 0.35 };
}

/** One tick of a phone playing a filter-coffee runner with the joystick and the ACTION button. */
function coffeeBot(name: string, filterIndex: number) {
  let lastPress = 0;
  return async (s: Dbg, phone: Page, move: (x: number, y: number) => Promise<unknown>) => {
    const me = s.chefs.find((c) => c.name === name);
    if (!me || s.phase !== "service") return move(0, 0);
    const of = (code: string) => s.tiles.filter((t) => t.code === code);
    const filters = of("f");
    const filter = filters[Math.min(filterIndex, filters.length - 1)];
    const cups = of("c")[0], win = of("w")[0];
    let goal: Tile | undefined, want = "";
    if (me.holding === "coffee") [goal, want] = [win, "serve"];
    else if (me.holding === "cup") [goal, want] = [filter, "place"];
    else if (filter?.item === "coffee") [goal, want] = [filter, "pick"];
    else if (filter?.item === "cup") [goal, want] = [filter, "none"];
    else if (me.holding) [goal, want] = [win, "none"];
    else [goal, want] = [cups, "pick"];
    if (!goal) return move(0, 0);
    const dir = steer(s, me, goal.c, goal.r);
    if (dir) await move(dir.x, -dir.z);
    if (me.verb === want && want !== "none" && Date.now() - lastPress > 350) {
      lastPress = Date.now();
      await action(phone);
    }
  };
}

test("Tiffin Tornado with buttons: two phones cook and serve filter coffee through all three quick services to the results", async ({ browser }) => {
  test.setTimeout(420_000);
  const { tv, code } = await tiffinTv(browser, "lite");
  const a = await joinPhone(browser, code, "Asha");
  const b = await joinPhone(browser, code, "Ravi");
  await start(tv);
  for (const [p, n] of [[a, "Asha"], [b, "Ravi"]] as const) await practiseUntilReady(tv, p, n, ["btn:ACTION", "btn:DASH"]);
  const st = stateOf(tv);
  await expect.poll(async () => (await st()).phase, { timeout: 60_000 }).toBe("service");
  await expect(a.locator('.game-pad[data-mode="buttons"] .stick')).toBeVisible();
  await a.screenshot({ path: "test-results/tiffin-pad-buttons.png" });
  const moveA = await thumb(a), moveB = await thumb(b);
  const botA = coffeeBot("Asha", 0), botB = coffeeBot("Ravi", 1);
  const fps: number[] = [];
  const shots = new Set<string>();
  let dashed = false;
  const until = Date.now() + 300_000; // generous: a busy machine slows the whole quick trip
  while (Date.now() < until) {
    const s = await st();
    if (s.phase === "results") break;
    if (s.phase === "service") {
      fps.push(s.fps);
      await botA(s, a, moveA);
      await botB(s, b, moveB);
      if (!dashed && s.t > 2) { dashed = true; await b.locator(".game-pad .action", { hasText: "DASH" }).dispatchEvent("pointerdown"); }
      const key = `L${s.level}`;
      if (!shots.has(key) && s.t > s.seconds * 0.45) {
        shots.add(key);
        await tv.screenshot({ path: `test-results/tiffin-lite-service${s.level + 1}.png` });
      }
    }
    await tv.waitForTimeout(90);
  }
  const end = await st();
  expect(end.phase).toBe("results");
  await expect(a.getByText(/team points/)).toBeVisible({ timeout: 5000 }); // the phone's end screen
  expect(end.results.map((r) => r.level)).toEqual([1, 2, 3]);
  const served = end.results.reduce((n, r) => n + r.served, 0);
  expect(served).toBeGreaterThanOrEqual(1);
  expect(end.team).toBeGreaterThan(0);
  const asha = end.chefs.find((c) => c.name === "Asha")!, ravi = end.chefs.find((c) => c.name === "Ravi")!;
  expect(asha.got.act).toBeGreaterThanOrEqual(2); // both phones' ACTION presses reached the TV
  expect(ravi.got.act).toBeGreaterThanOrEqual(2);
  expect(ravi.got.dash).toBeGreaterThanOrEqual(1);
  await expect(tv.locator("[data-award]").first()).toBeVisible({ timeout: 8000 });
  await tv.waitForTimeout(1500);
  await tv.screenshot({ path: "test-results/tiffin-results.png" });
  console.log(`tiffin lite: served ${served}, team ${end.team}, fps min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}, draw calls ${end.calls}, triangles ${end.tris}`);
  expect(end.calls).toBeLessThan(40);
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 30_000 });
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test("Tiffin Tornado with the touchpad: drag to walk to the tumblers, tap to pick one up, swipe to dash", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await tiffinTv(browser, "lite");
  const p = await joinPhone(browser, code, "Meena", { "Tiffin Tornado": "touchpad" });
  await start(tv);
  await practiseUntilReady(tv, p, "Meena", ["pad:tap", "pad:swipe-left"]);
  const st = stateOf(tv);
  await expect.poll(async () => (await st()).phase, { timeout: 60_000 }).toBe("service");
  await expect(p.locator('.game-pad[data-mode="touchpad"] .touchpad')).toBeVisible();
  const startAt = (await st()).chefs[0]!;
  // walk: hold a finger off-centre on the pad (finger position = movement), steering towards the tumblers
  const pad = p.locator(".game-pad .touchpad");
  const box = (await pad.boundingBox())!;
  let picked = false;
  for (let i = 0; i < 200 && !picked; i++) {
    const s = await st();
    const me = s.chefs[0]!;
    const cups = s.tiles.find((t) => t.code === "c")!;
    if (me.holding === "cup") { picked = true; break; }
    const dir = steer(s, me, cups.c, cups.r) ?? { x: 0, z: 0 };
    if (me.verb === "pick") { await padTap(p); continue; }
    const px = box.x + box.width / 2 + dir.x * box.width * 0.4, py = box.y + box.height / 2 + dir.z * box.height * 0.4;
    await p.mouse.move(px, py);
    await p.mouse.down();
    await p.waitForTimeout(140);
    await p.mouse.up();
  }
  await swipe(p, { x: -0.6, y: 0 }, { x: 0.6, y: 0 }, 140);
  await expect.poll(async () => (await st()).chefs[0]!.got.dash, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  const s = await st();
  const me = s.chefs[0]!;
  expect(Math.hypot(me.x - startAt.x, me.z - startAt.z)).toBeGreaterThan(0.5);
  expect(me.got.act).toBeGreaterThanOrEqual(1);
  expect(me.got.dash).toBeGreaterThanOrEqual(1);
  expect(picked).toBe(true);
  await tv.screenshot({ path: "test-results/tiffin-touchpad.png" });
  await p.screenshot({ path: "test-results/tiffin-pad-touchpad.png" });
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

// Real-time tiers: correctness and screenshots (headless Chromium renders them in software, so no fps checks).
for (const quality of ["high", "ultra"]) {
  test(`Tiffin Tornado renders the real-time diorama on the ${quality} tier`, async ({ browser }) => {
    test.setTimeout(400_000); // ultra in software GL draws about one frame every few seconds
    const { tv, code } = await tiffinTv(browser, quality);
    const p = await joinPhone(browser, code, "Kavin");
    await start(tv);
    await practiseUntilReady(tv, p, "Kavin", ["btn:ACTION", "btn:DASH"]);
    const st = stateOf(tv);
    // the kitchen GLB, chefs, food and the HDRI are loaded and a frame has been drawn through the post chain
    await expect.poll(async () => (await st()).calls ?? 0, { timeout: 120_000, intervals: [2000] }).toBeGreaterThan(5);
    let s = await st();
    expect(s.tier).toBe(quality);
    expect(s.tris).toBeGreaterThan(10_000);
    await tv.screenshot({ path: `test-results/tiffin-${quality}-intro.png`, timeout: 90_000 });
    // give the (slow, software-rendered) game time to reach the service, then catch a frame of it
    // best effort: high gets to the service in software GL, ultra (GTAO + SMAA at 1440p) may not in time
    await expect.poll(async () => (s = await st()).phase, { timeout: quality === "ultra" ? 60_000 : 150_000, intervals: [3000] }).toBe("service").catch(() => undefined);
    await tv.waitForTimeout(3000);
    s = await st();
    await tv.screenshot({ path: `test-results/tiffin-${quality}.png`, timeout: 90_000 });
    console.log(`tiffin ${quality}: phase ${s.phase}, fps ${s.fps} (software GL), draw calls ${s.calls}, triangles ${s.tris}`);
    expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });
}

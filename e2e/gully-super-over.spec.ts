import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, practiseUntilReady, press, swipe, tvCode, type Mode } from "./helpers";

type Dbg = {
  phase: string; stage: number; batting: number; tier: string; fps: number; calls: number; tris: number; camera: string;
  ball: { n: number; batter: string | null; bowler: string; bowlOut: boolean; eta: number | null; contactAt: number | null; kind: string | null } | null;
  teams: Array<{ runs: number; wickets: number; balls: number }>; winner: number | null; decided: string | null;
  timing: string; results: string[]; got: Record<string, Record<string, number>>; humans: Array<{ id: string; name: string; team: number }>;
};

const BAT = "Gully Super Over · Bat";
const BOWL = "Gully Super Over · Bowl";

async function gullyTv(browser: Browser, quality: string) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await tv.goto(`/tv?quick=1&quality=${quality}`);
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => async (): Promise<Dbg> => JSON.parse((await tv.locator("[data-gully]").getAttribute("data-gully").catch(() => "")) || "{}");

async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Gully Super Over" }).click();
  await tv.getByRole("button", { name: /Start Gully Super Over/ }).click();
}

const shot = (p: Page, name: string) => p.screenshot({ path: `test-results/gully-${name}.png`, timeout: 30_000 });

/**
 * Plays the match to the end: each human bats (motion: a real swing burst on the synthetic sensor timed to the
 * ball's arrival; buttons: SWING) and bowls (touchpad: drag to aim, PACE/SPIN, flick up; buttons: BOWL).
 */
async function playMatch(tv: Page, phones: Record<string, { page: Page; bat: Mode; bowl: Mode }>, shots: string) {
  const s = stateOf(tv);
  const taken = new Set<string>();
  const fps: number[] = [];
  let handled = -1, swung = -1, k = 0;
  const until = Date.now() + 200_000;
  while (Date.now() < until) {
    const st = await s();
    if (st.phase === "podium") break;
    const b = st.ball;
    const who = (id: string | null | undefined) => st.humans?.find((h) => h.id === id)?.name;
    if (st.fps) fps.push(st.fps);
    if (fps.length % 40 === 1) console.log(`[gully] ${st.phase} fps ${st.fps} calls ${st.calls} cam ${st.camera}`);
    if (b && st.phase === "aim" && handled !== b.n && who(b.bowler)) {
      handled = b.n;
      const p = phones[who(b.bowler)!]!;
      await expect(p.page.locator(".game-pad .action", { hasText: "BOWL" })).toBeVisible({ timeout: 5000 });
      if (p.bowl === "touchpad") {
        // drag to aim (a different spot each ball), pick the type, then flick up to let it go
        await swipe(p.page, { x: -0.1, y: 0.1 }, { x: [0.2, -0.3, 0][k % 3]!, y: [-0.2, 0.3, -0.5][k % 3]! }, 500);
        await press(p.page, k % 2 ? "SPIN" : "PACE");
        await p.page.waitForTimeout(350);
        await swipe(p.page, { x: 0, y: -0.7 }, { x: 0, y: 0.8 }, 120);
      } else {
        await press(p.page, "BOWL");
      }
      k++;
    }
    const humanSwing = !!b && (st.phase === "runup" || st.phase === "delivery") && !!who(b.batter);
    if (b && humanSwing && swung !== b.n && b.contactAt !== null) {
      const p = phones[who(b.batter)!]!;
      // the TV and the phones share this machine's clock: fire so the swing peaks as the ball reaches the bat
      // (the TV subtracts its latency allowance, which covers sensing and the radio hop)
      const wait = b.contactAt - Date.now() + (p.bat === "motion" ? -15 : 15) + ((k % 3) - 1) * 30;
      swung = b.n;
      if (wait > 0) await p.page.waitForTimeout(wait);
      if (p.bat === "motion") await gesture(p.page, "flick-right", 30 + (k % 3) * 4);
      else await press(p.page, k % 4 === 3 ? "DEFEND" : "SWING");
      const after = await s();
      console.log(`[gully] swing (waited ${wait}) → ${after.phase} timing ${after.timing} results ${after.results.join(",")}`);
      continue;
    }
    for (const want of ["delivery", "play", "replay", "break", "result"]) {
      if (!humanSwing && st.phase === want && !taken.has(want) && (want !== "play" || (b && st.camera.startsWith("track")) || st.tier === "lite")) {
        taken.add(want);
        await tv.waitForTimeout(want === "replay" ? 700 : 250);
        await shot(tv, `${shots}-${want}`);
      }
    }
    await tv.waitForTimeout(25);
  }
  return { end: await s(), fps };
}

async function finishAndCheck(tv: Page, phones: Page[], end: Dbg, shots: string) {
  expect(end.phase).toBe("podium");
  expect(end.winner === 0 || end.winner === 1).toBe(true);
  for (const p of phones) await expect(p.getByText(/win/)).toBeVisible({ timeout: 15_000 }); // the phone's final screen
  await expect(tv.locator("[data-award]").first()).toBeVisible({ timeout: 8000 });
  await tv.waitForTimeout(1200);
  await shot(tv, `${shots}-podium`);
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 20_000 });
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
}

/** The real-time tiers need a real GPU (the default headless Chromium renders WebGL in software, SwiftShader). */
const GPU_ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];

test("Gully Super Over: two phones play a quick match — swing-batting (motion) and touchpad bowling — to the result (high)", async ({ playwright }) => {
  test.setTimeout(300_000);
  const browser = await playwright.chromium.launch({ args: GPU_ARGS });
  const { tv, code } = await gullyTv(browser, "high");
  const modes = { [BAT]: "motion", [BOWL]: "touchpad" } as Record<string, Mode>;
  const a = await joinPhone(browser, code, "Asha", modes);
  const b = await joinPhone(browser, code, "Ravi", modes);
  await start(tv);
  for (const [p, n] of [[a, "Asha"], [b, "Ravi"]] as const) await practiseUntilReady(tv, p, n, ["flick-right"]);
  const s = stateOf(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 30_000 }).toMatch(/intro|innings|aim/);
  await shot(tv, "high-intro");
  const { end, fps } = await playMatch(tv, { Asha: { page: a, bat: "motion", bowl: "touchpad" }, Ravi: { page: b, bat: "motion", bowl: "touchpad" } }, "high");
  console.log(`gully high: fps min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}, calls ${end.calls}, tris ${end.tris}; results ${end.results.join(",")}; timing ${end.timing}`);
  // both teams batted their 3 balls (or the chase ended early), swings and bowls reached the TV
  // the first innings ends after its 3 balls or when both batters are out; then the chase
  expect(end.teams[0]!.balls === 3 || end.teams[0]!.wickets === 2).toBe(true);
  expect(end.teams[1]!.balls).toBeGreaterThan(0);
  const swings = Object.values(end.got).reduce((n, g) => n + (g.swing ?? 0), 0);
  const bowls = Object.values(end.got).reduce((n, g) => n + (g.bowl ?? 0), 0);
  expect(swings).toBeGreaterThanOrEqual(2);
  expect(bowls).toBeGreaterThanOrEqual(2);
  expect(end.results.length).toBeGreaterThanOrEqual(3);
  expect(end.results.some((r) => !["bowled", "dot", "miss", "wide"].includes(r))).toBe(true); // bat met ball
  await finishAndCheck(tv, [a, b], end, "high");
  await shot(a, "phone-bat");
  await browser.close();
});

test("Gully Super Over solo on ultra: one phone and CPU kids, screenshots of every camera", async ({ playwright }) => {
  test.setTimeout(240_000);
  const browser = await playwright.chromium.launch({ args: GPU_ARGS });
  const { tv, code } = await gullyTv(browser, "ultra");
  const a = await joinPhone(browser, code, "Divya", { [BAT]: "buttons", [BOWL]: "touchpad" });
  await start(tv);
  await practiseUntilReady(tv, a, "Divya", ["btn:SWING"]);
  const { end } = await playMatch(tv, { Divya: { page: a, bat: "buttons", bowl: "touchpad" } }, "ultra");
  expect(end.tier).toBe("ultra");
  await finishAndCheck(tv, [a], end, "ultra");
  await browser.close();
});

/** Lite runs on the default software renderer: a pessimistic stand-in for a 1 GB TV's GPU. */
test("Gully Super Over with buttons: SWING / DEFEND and BOWL buttons play a quick match (lite tier)", async ({ browser }) => {
  test.setTimeout(300_000);
  const { tv, code } = await gullyTv(browser, "lite");
  const modes = { [BAT]: "buttons", [BOWL]: "buttons" } as Record<string, Mode>;
  const a = await joinPhone(browser, code, "Meena", modes);
  const b = await joinPhone(browser, code, "Karthik", modes);
  await start(tv);
  for (const [p, n] of [[a, "Meena"], [b, "Karthik"]] as const) await practiseUntilReady(tv, p, n, ["btn:SWING"]);
  await expect(a.locator(".game-pad .action", { hasText: "SWING" })).toBeVisible({ timeout: 20_000 });
  const { end, fps } = await playMatch(tv, { Meena: { page: a, bat: "buttons", bowl: "buttons" }, Karthik: { page: b, bat: "buttons", bowl: "buttons" } }, "lite");
  console.log(`gully lite: fps min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}, calls ${end.calls}; results ${end.results.join(",")}`);
  expect(end.tier).toBe("lite");
  expect(end.calls).toBeLessThan(40);
  expect(end.teams[0]!.balls === 3 || end.teams[0]!.wickets === 2).toBe(true);
  expect(Object.values(end.got).reduce((n, g) => n + (g.swing ?? 0), 0)).toBeGreaterThanOrEqual(2);
  await finishAndCheck(tv, [a, b], end, "lite");
});

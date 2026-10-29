import { expect, test, type Browser, type Page } from "@playwright/test";
import { joinPhone, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

type Rider = { id: string; name: string; cpu: boolean; kind: string; pick: number; locked: boolean; place: number; lap: number; cleared: number; next: number; kmh: number; meter: number; done: boolean; x: number; z: number; y: number; air: boolean; turn: number; stats: Record<string, number>; got: { boost: number; drift: number } | null };
type Dbg = { phase: string; clock: number; fps: number; ms: { sim: number; draw: number }; calls: number; tris: number; tier: string; views: number; laps: number; gates: number; riders: Rider[] };

async function cityTv(browser: Browser, quality: string) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  await tv.goto(`/tv?quick=1&quality=${quality}`);
  return { tv, code: await tvCode(tv), errors };
}
const stateOf = (tv: Page) => async (): Promise<Dbg> => JSON.parse((await tv.locator("[data-city]").getAttribute("data-city").catch(() => "")) || "{}");
async function arrow(page: Page, dir: "left" | "right", down: boolean) {
  await page.locator(`.game-pad .arrow-${dir}`).first().dispatchEvent(down ? "pointerdown" : "pointerup", { pointerId: 21 }, { timeout: 2000 }).catch(() => undefined);
}

test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });

// lite is what the TV boxes run (and all a CI runner's software GPU can manage); CITY_QUALITY=ultra locally for the full look
const QUALITY = process.env.CITY_QUALITY ?? "lite";

test(`CITY RIVALS (${QUALITY}): two phones pick rides in the garage, then drive the district through the gates to the results`, async ({ browser }) => {
  test.setTimeout(300_000);
  const { tv, code, errors } = await cityTv(browser, QUALITY);
  const a = await joinPhone(browser, code, "Asha");                                   // hybrid wheel
  const b = await joinPhone(browser, code, "Ravi", { "CITY RIVALS": "buttons" });
  await tv.locator(".game-card", { hasText: "CITY RIVALS" }).click();
  await tv.getByRole("button", { name: /Start CITY RIVALS/ }).click();
  await practiseUntilReady(tv, a, "Asha", ["btn:BOOST"]);
  await practiseUntilReady(tv, b, "Ravi", ["btn:BOOST"]);
  const s = stateOf(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 60_000 }).toBe("garage");
  const first = await s();
  expect(first.riders.length).toBe(4);                                               // 2 people + 2 CPUs
  expect(first.views).toBe(2);
  // garage: Ravi taps ▶ once (auto → scooter) and locks in; Asha tilts the wheel right twice (→ car)
  await arrow(b, "right", true);
  await expect.poll(async () => (await s()).riders.find((r) => r.name === "Ravi")!.pick, { timeout: 5000 }).toBe(1);
  await arrow(b, "right", false);
  await press(b, "BOOST");
  for (let k = 0; k < 2; k++) {
    await pose(a, upright(35, 0), 300);
    await pose(a, upright(0, 0), 300);
  }
  await expect.poll(async () => (await s()).riders.find((r) => r.name === "Asha")!.pick, { timeout: 5000 }).toBe(2);
  await tv.screenshot({ path: `test-results/city-${QUALITY}-garage.png` });
  await press(a, "BOOST");
  await expect.poll(async () => (await s()).phase, { timeout: 10_000 }).toMatch(/intro|countdown/);
  const locked = await s();
  expect(locked.riders.find((r) => r.name === "Ravi")!.kind).toBe("scooter");
  expect(locked.riders.find((r) => r.name === "Asha")!.kind).toBe("car");
  await tv.screenshot({ path: `test-results/city-${QUALITY}-intro.png` });
  await expect.poll(async () => (await s()).phase, { timeout: 20_000 }).toBe("race");

  // drive: Asha steers the wheel by the route hint, Ravi taps ◀ ▶; both boost when the meter allows
  let steerB: "left" | "right" | null = null, shots = 0;
  const fps: number[] = [];
  const until = Date.now() + 200_000;
  while (Date.now() < until) {
    const st = await s();
    if (st.phase !== "race") break;
    if (st.clock > 3) fps.push(st.fps);
    const ra = st.riders.find((r) => r.name === "Asha")!, rb = st.riders.find((r) => r.name === "Ravi")!;
    if (!ra.done) await pose(a, upright(Math.max(-35, Math.min(35, ra.turn * 35)), 0), 0);
    if (ra.meter >= 0.34 && Math.abs(ra.turn) < 0.15) await press(a, "BOOST").catch(() => undefined);
    const want = rb.turn > 0.2 ? "right" : rb.turn < -0.2 ? "left" : null;
    if (want !== steerB) {
      if (steerB) await arrow(b, steerB, false);
      if (want) await arrow(b, want, true);
      steerB = want;
    }
    if (shots < 3 && st.clock > 8 + shots * 15) await tv.screenshot({ path: `test-results/city-${QUALITY}-race-${shots++}.png` });
    await tv.waitForTimeout(40);
  }
  if (steerB) await arrow(b, steerB, false);
  const end = await s();
  expect(end.phase).toBe("results");
  await tv.screenshot({ path: `test-results/city-${QUALITY}-results.png` });
  const ra = end.riders.find((r) => r.name === "Asha")!, rb = end.riders.find((r) => r.name === "Ravi")!;
  console.log("city:", JSON.stringify({ clock: end.clock, tier: end.tier, calls: end.calls, tris: end.tris, ms: end.ms, fps: fps.length ? Math.round(fps.reduce((x, y) => x + y) / fps.length) : 0, a: ra, b: rb }));
  // the phones really drove: gates cleared, drive inputs received, the boost button went through
  // a CI runner draws this at ~10 fps, too coarse for the test's own steering loop to hold a line through the
  // district: there it must still reach a gate, on a real GPU it must get round most of the course
  const gates = process.env.CI ? 1 : 4;
  expect(ra.cleared).toBeGreaterThanOrEqual(gates);
  expect(rb.cleared).toBeGreaterThanOrEqual(gates);
  expect(ra.got!.boost).toBeGreaterThan(0);
  expect(end.riders.filter((r) => r.done).length).toBeGreaterThanOrEqual(1);
  expect(end.calls).toBeLessThan(QUALITY === "lite" ? 140 : 200);
  expect(ra.stats.coins + rb.stats.coins).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(await tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  // the round ends on the TV's scoreboard
  await expect(a.getByText(/You rule the city!|You finished/)).toBeVisible({ timeout: 20_000 });
  await expect(b.getByText(/You rule the city!|You finished/)).toBeVisible({ timeout: 20_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 30_000 });
});

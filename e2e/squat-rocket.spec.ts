import { expect, test, type Browser, type Page } from "@playwright/test";
import { joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

// a fake camera (an empty test pattern) that is allowed without a prompt
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

type Dbg = {
  phase: string; t: number; paused: boolean; shield: number; beaten: boolean | null;
  incoming: Array<{ id: string; in: number }>;
  rockets: Array<{ id: string; name: string; mode: string; ok: boolean; reps: number; fuel: number; score: number; alt: number; dodges: number; hits: number; jacks: number; warm: number }>;
};
const stateOf = (tv: Page) => async (): Promise<Dbg> => JSON.parse((await tv.locator("[data-rocket]").getAttribute("data-rocket").catch(() => "")) || "{}");

async function rocketTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
async function startRocket(tv: Page) {
  await tv.locator(".game-card", { hasText: "Squat Rocket" }).click();
  await tv.getByRole("button", { name: /Start Squat Rocket/ }).click();
}

/** Test hook: a synthetic player stands in front of the fake camera (see apps/web/src/phone/camera/fakePose.ts). */
async function fakeBody(phone: Page) {
  await phone.evaluate(() => { (window as unknown as { __fakePose: unknown }).__fakePose = { queue: [], base: {}, done: 0 }; });
}
/** Queues a body move unless one is still playing. */
async function move(phone: Page, m: string) {
  return phone.evaluate((mv) => {
    const c = (window as unknown as { __fakePose: { queue: string[] } }).__fakePose;
    if (c.queue.length) return false;
    c.queue.push(mv);
    return true;
  }, m);
}
async function cameraOn(phone: Page, opts: { seated?: boolean; gentle?: boolean } = {}) {
  await expect(phone.getByText(/Your camera video never leaves this phone/)).toBeVisible({ timeout: 15_000 });
  if (opts.seated) await phone.getByRole("button", { name: "🪑 Seated" }).click();
  if (opts.gentle) await phone.getByRole("button", { name: "🌱 Gentle" }).click();
  await expect(phone.getByRole("button", { name: /Turn on camera/ })).toBeDisabled(); // the space check comes first
  await phone.getByRole("button", { name: /cleared the space/ }).click();
  await phone.getByRole("button", { name: /Turn on camera/ }).click();
  await expect(phone.locator(".cam-pad[data-cam=running]")).toBeVisible({ timeout: 20_000 });
}

test("Squat Rocket: two camera players (standing + seated) squat, dodge, do jacks, pause and reach the podium", async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await rocketTv(browser);
  const a = await joinPhone(browser, code, "Ravi");
  const b = await joinPhone(browser, code, "Divya");
  await fakeBody(a);
  await fakeBody(b);
  await startRocket(tv);
  await expect(a.getByText(/Your camera video never leaves this phone/)).toBeVisible({ timeout: 15_000 });
  await a.screenshot({ path: "test-results/rocket-phone-setup.png" });
  await cameraOn(a);
  await cameraOn(b, { seated: true, gentle: true });
  await expect(a.locator(".cam-silhouette")).toBeVisible();
  await a.waitForTimeout(800);
  await a.screenshot({ path: "test-results/rocket-phone-calibrating.png" });
  // calibration: stand still ~3 s, then the play screen with the big counter (preview hidden)
  await expect(a.locator(".cam-pad[data-track=ready] .cam-count")).toBeVisible({ timeout: 15_000 });
  await expect(b.locator(".cam-pad[data-track=ready] .cam-count")).toBeVisible({ timeout: 15_000 });
  await expect(a.locator(".cam-video.hidden")).toHaveCount(1);
  await expect(a.getByText("Camera on · video stays on this phone")).toBeVisible();

  // get-ready screen: one pump each (a squat standing, an arm raise seated)
  await move(a, "squat");
  await move(b, "raise");
  await practiseUntilReady(tv, a, "Ravi", []);
  await practiseUntilReady(tv, b, "Divya", []);

  const st = stateOf(tv);
  await expect.poll(async () => (await st()).phase, { timeout: 20_000 }).toBe("warmup");
  const shots = new Set<string>();
  let paused = false, resumed = false;
  const until = Date.now() + 150_000;
  while (Date.now() < until) {
    const s = await st();
    if (!s.phase) { await tv.waitForTimeout(100); continue; }
    if (s.phase === "done") break;
    const ra = s.rockets.find((r) => r.name === "Ravi")!;
    if (s.phase === "warmup") { await move(a, "raise"); await move(b, "raise"); }
    if (s.phase === "fuel") {
      if (!paused && ra.reps >= 2) {
        await a.evaluate(() => { const c = (window as unknown as { __fakePose: { queue: string[] } }).__fakePose; c.queue.length = 0; c.queue.push("head"); });
        await expect.poll(async () => (await st()).paused, { timeout: 8000 }).toBe(true);
        paused = true;
        await tv.screenshot({ path: "test-results/rocket-paused.png" });
        await tv.waitForTimeout(1700);
        await b.locator(".cam-pause").click();            // the big Pause button resumes
        await expect.poll(async () => (await st()).paused, { timeout: 5000 }).toBe(false);
        resumed = true;
        continue;
      }
      await move(a, "squat");
      await move(b, "raise");
      if (ra.reps >= 3 && !shots.has("fuel")) { shots.add("fuel"); await tv.screenshot({ path: "test-results/rocket-fuel.png" }); await a.screenshot({ path: "test-results/rocket-phone-play.png" }); }
    }
    if (s.phase === "climb") {
      for (const inc of s.incoming) {
        const who = s.rockets.find((r) => r.id === inc.id)!;
        if (inc.in < 0.75 && inc.in > 0.2) await move(who.name === "Ravi" ? a : b, who.name === "Ravi" ? "jump" : "punch");
      }
      if (s.t > 4 && !shots.has("climb")) { shots.add("climb"); await tv.screenshot({ path: "test-results/rocket-climb.png" }); }
    }
    if (s.phase === "storm") {
      await move(a, "jack");
      await move(b, "arm-jack");
      if (s.t > 4 && !shots.has("storm")) { shots.add("storm"); await tv.screenshot({ path: "test-results/rocket-storm.png" }); }
    }
    await tv.waitForTimeout(40);
  }
  const end = await st();
  expect(end.phase).toBe("done");
  expect(paused && resumed).toBe(true);
  const [ra, rb] = [end.rockets.find((r) => r.name === "Ravi")!, end.rockets.find((r) => r.name === "Divya")!];
  expect(ra.mode).toBe("camera");
  expect(rb.mode).toBe("camera");
  expect(ra.warm + rb.warm).toBeGreaterThan(0);
  expect(ra.reps).toBeGreaterThanOrEqual(3);        // squats pumped fuel
  expect(rb.reps).toBeGreaterThanOrEqual(2);        // seated arm raises pumped fuel
  expect(ra.dodges + rb.dodges).toBeGreaterThan(0); // jumps / punches dodged meteors
  expect(ra.jacks).toBeGreaterThan(0);
  expect(rb.jacks).toBeGreaterThan(0);              // seated arm jacks
  await expect(tv.locator("[data-podium]")).toBeVisible({ timeout: 10_000 });
  await tv.waitForTimeout(700);
  await tv.screenshot({ path: "test-results/rocket-podium.png" });
  await expect(tv.getByText(/lifted the rocket \d+ times/)).toBeVisible();
  await expect(a.getByText(/You won!|You came/)).toBeVisible({ timeout: 15_000 });
  // the camera stops when the game ends (no live video stream left on the phone)
  await expect.poll(() => a.evaluate(() => [...document.querySelectorAll("video")].filter((v) => v.srcObject).length)).toBe(0);
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Squat Rocket fallback: a player without the camera plays the whole game with buttons", async ({ browser }) => {
  test.setTimeout(180_000);
  const { tv, code } = await rocketTv(browser);
  const p = await joinPhone(browser, code, "Meena");
  await startRocket(tv);
  await expect(p.getByText(/Your camera video never leaves this phone/)).toBeVisible({ timeout: 15_000 });
  await p.getByRole("button", { name: /Play with buttons instead/ }).click();
  await expect(p.locator('.game-pad[data-mode="buttons"]')).toBeVisible();
  await expect(p.locator(".game-pad .action", { hasText: "PUMP" })).toBeVisible();
  await practiseUntilReady(tv, p, "Meena", ["btn:PUMP"]);
  const st = stateOf(tv);
  let lastPump = 0;
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const s = await st();
    if (s.phase === "done") break;
    if (s.phase === "fuel" && Date.now() - lastPump > 1300) { lastPump = Date.now(); await press(p, "PUMP").catch(() => undefined); }
    if (s.phase === "climb" && s.incoming.some((i) => i.in < 0.7 && i.in > 0.2)) await press(p, "JUMP").catch(() => undefined);
    if (s.phase === "storm") await press(p, "JACK").catch(() => undefined);
    await tv.waitForTimeout(60);
  }
  const end = await st();
  expect(end.phase).toBe("done");
  const r = end.rockets[0]!;
  expect(r.mode).toBe("buttons");
  expect(r.reps).toBeGreaterThanOrEqual(3);
  expect(r.dodges).toBeGreaterThan(0);
  expect(r.jacks).toBeGreaterThan(0);
  await expect(tv.locator("[data-podium]")).toBeVisible({ timeout: 10_000 });
  await p.screenshot({ path: "test-results/rocket-phone-buttons.png" });
});

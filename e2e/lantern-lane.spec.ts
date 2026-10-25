import { expect, test } from "@playwright/test";
import { gesture, joinPhone, pose, practiseUntilReady, upright } from "./helpers";
import { closeAll, csp, expectLiteBudgets, joinTwo, platState, platTv, playToPodium, ready, startGame } from "./platformer";

const TIER = process.env.PLAT_TIER ?? "lite";
if (process.env.PLAT_GPU) test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });
test.afterEach(async ({ browser }) => closeAll(browser));

test(`Lantern Lane with buttons (${TIER}): two phones play the quick festival dash together to the podium`, async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await platTv(browser, `quality=${TIER}`);
  const [a, b] = await joinTwo(browser, code);
  await startGame(tv, "Lantern Lane");
  await ready(tv, a, "Asha");
  await ready(tv, b, "Ravi");
  const s = platState(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 30_000 }).toMatch(/intro|play/);
  expect((await s()).mode).toBe("coop");
  for (const label of ["JUMP", "RUN", "THROW"]) await expect(a.locator(".game-pad .action", { hasText: label })).toBeVisible();
  await expect(a.locator('.game-pad[data-mode="buttons"] .arrow-up')).toBeVisible(); // ▲ ▼ for ladders
  await expect.poll(async () => (await s()).phase, { timeout: 15_000 }).toBe("play");
  let shot = false;
  const fps = await playToPodium(tv, [a, b], 160_000, async (st) => {
    if (!shot && st.phase === "play" && st.time > 4) {
      shot = true;
      await tv.screenshot({ path: `test-results/lantern-play-${TIER}.png` });
      console.log(`lantern ${st.tier}: draw calls ${st.calls}, triangles ${st.tris}, decoded ${st.decodedMB} MB, load ${st.loadMs} ms, fps ${st.fps}`);
      if (st.tier === "lite") expectLiteBudgets(st);
    }
  });
  const end = await s();
  expect(end.phase).toBe("podium");
  await expect(tv.locator("[data-award]").first()).toBeVisible({ timeout: 8000 });
  await tv.waitForTimeout(1500);
  await tv.screenshot({ path: `test-results/lantern-podium-${TIER}.png` });
  expect(end.results).toHaveLength(2);
  await expect(a.getByText(/Star of the festival|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(b.getByText(/Star of the festival|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 25_000 });
  console.log(`lantern ${TIER}: fps min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}`);
  expect(await csp(tv)).toEqual([]);
});

test("Lantern Lane with motion: tilt to run, flick up to jump, push to throw", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await platTv(browser, "quality=lite&mode=race");
  const p = await joinPhone(browser, code, "Meena", { "Lantern Lane": "motion" });
  await startGame(tv, "Lantern Lane");
  await pose(p, upright(0, 0), 900);
  await practiseUntilReady(tv, p, "Meena", ["flick-up"]);
  const s = platState(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 30_000 }).toBe("play");
  expect((await s()).mode).toBe("race");
  await expect(p.locator('.game-pad[data-mode="motion"]')).toBeVisible();
  const x0 = (await s()).heroes[0]!.x;
  await pose(p, upright(24, 0), 1800);                 // turn the phone right like a wheel: run
  const x1 = (await s()).heroes[0]!.x;
  expect(x1 - x0).toBeGreaterThan(3);
  const j0 = (await s()).heroes[0]!.jumps;
  await gesture(p, "flick-up");
  await gesture(p, "flick-up");
  await expect.poll(async () => (await s()).heroes[0]!.jumps, { timeout: 5000 }).toBeGreaterThan(j0);
  await gesture(p, "push");
  const me = (await s()).heroes[0]!;
  expect(me.got!.hop).toBeGreaterThanOrEqual(2);
  expect(me.got!.act).toBeGreaterThanOrEqual(1);
  await pose(p, upright(0, 0), 300);
  await tv.screenshot({ path: "test-results/lantern-motion.png" });
  await p.screenshot({ path: "test-results/lantern-pad-motion.png" });
  expect(await csp(tv)).toEqual([]);
});

for (const tier of ["lite", "high"] as const) {
  test(`Lantern Lane renders in the ${tier} tier`, async ({ browser }) => {
    test.skip(!process.env.PLAT_SHOTS, "screenshots for review: PLAT_SHOTS=1");
    test.setTimeout(90_000);
    const { tv, code } = await platTv(browser, `quality=${tier}&mode=coop`);
    const a = await joinPhone(browser, code, "Asha");
    await startGame(tv, "Lantern Lane");
    await ready(tv, a, "Asha");
    const s = platState(tv);
    await expect.poll(async () => (await s()).phase, { timeout: 40_000 }).toBe("play");
    await playToPodium(tv, [a], 3500);
    const st = await s();
    console.log(`lantern ${tier}: fps ${st.fps}, draw calls ${st.calls}, triangles ${st.tris}, decoded ${st.decodedMB} MB`);
    await tv.screenshot({ path: `test-results/lantern-${tier}.png` });
    expect(st.tier).toBe(tier);
  });
}

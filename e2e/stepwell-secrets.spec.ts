import { expect, test } from "@playwright/test";
import { joinPhone, padMove, practiseUntilReady, swipe } from "./helpers";
import { closeAll, csp, expectLiteBudgets, joinTwo, platState, platTv, playToPodium, ready, startGame } from "./platformer";

const TIER = process.env.PLAT_TIER ?? "lite";
if (process.env.PLAT_GPU) test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });
test.afterEach(async ({ browser }) => closeAll(browser));

test(`Stepwell Secrets with buttons (${TIER}): two phones play the quick quick descent together to the podium`, async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await platTv(browser, `quality=${TIER}`);
  const [a, b] = await joinTwo(browser, code);
  await startGame(tv, "Stepwell Secrets");
  await ready(tv, a, "Asha");
  await ready(tv, b, "Ravi");
  const s = platState(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 30_000 }).toMatch(/intro|play/);
  expect((await s()).mode).toBe("coop");
  for (const label of ["JUMP", "RUN", "LEVER"]) await expect(a.locator(".game-pad .action", { hasText: label })).toBeVisible();
  await expect(a.locator('.game-pad[data-mode="buttons"] .arrow-up')).toBeVisible(); // ▲ ▼ for ladders
  await expect.poll(async () => (await s()).phase, { timeout: 15_000 }).toBe("play");
  let shot = false;
  const fps = await playToPodium(tv, [a, b], 170_000, async (st) => {
    if (!shot && st.phase === "play" && st.time > 4) {
      shot = true;
      await tv.screenshot({ path: `test-results/stepwell-play-${TIER}.png` });
      console.log(`stepwell ${st.tier}: draw calls ${st.calls}, triangles ${st.tris}, decoded ${st.decodedMB} MB, load ${st.loadMs} ms, fps ${st.fps}`);
      if (st.tier === "lite") expectLiteBudgets(st);
    }
  });
  const end = await s();
  expect(end.phase).toBe("podium");
  await expect(tv.locator("[data-award]").first()).toBeVisible({ timeout: 8000 });
  await tv.waitForTimeout(1500);
  await tv.screenshot({ path: `test-results/stepwell-podium-${TIER}.png` });
  expect(end.results).toHaveLength(2);
  await expect(a.getByText(/Keeper of the Well|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(b.getByText(/Keeper of the Well|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 25_000 });
  console.log(`stepwell ${TIER}: fps min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}`);
  expect(await csp(tv)).toEqual([]);
});

for (const tier of ["lite", "high"] as const) {
  test(`Stepwell Secrets renders in the ${tier} tier`, async ({ browser }) => {
    test.skip(!process.env.PLAT_SHOTS, "screenshots for review: PLAT_SHOTS=1");
    test.setTimeout(90_000);
    const { tv, code } = await platTv(browser, `quality=${tier}&mode=coop`);
    const a = await joinPhone(browser, code, "Asha");
    await startGame(tv, "Stepwell Secrets");
    await ready(tv, a, "Asha");
    const s = platState(tv);
    await expect.poll(async () => (await s()).phase, { timeout: 40_000 }).toBe("play");
    await playToPodium(tv, [a], 3500);
    const st = await s();
    console.log(`stepwell ${tier}: fps ${st.fps}, draw calls ${st.calls}, triangles ${st.tris}, decoded ${st.decodedMB} MB`);
    await tv.screenshot({ path: `test-results/stepwell-${tier}.png` });
    expect(st.tier).toBe(tier);
  });
}

test("Stepwell Secrets with the touchpad: drag to run, tap to jump, swipe down to pull a lever", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await platTv(browser, "quality=lite&mode=coop");
  const p = await joinPhone(browser, code, "Meena", { "Stepwell Secrets": "touchpad" });
  await startGame(tv, "Stepwell Secrets");
  await expect(p.locator('.game-pad[data-mode="touchpad"] .touchpad')).toBeVisible({ timeout: 30_000 });
  await practiseUntilReady(tv, p, "Meena", ["pad:tap"]);
  const s = platState(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 30_000 }).toBe("play");
  const x0 = (await s()).heroes[0]!.x;
  await swipe(p, { x: 0, y: 0 }, { x: 0.95, y: 0 }, 1400); // a slow drag to the right: run
  await expect.poll(async () => (await s()).heroes[0]!.x, { timeout: 5000 }).toBeGreaterThan(x0 + 1.5);
  const j0 = (await s()).heroes[0]!.jumps;
  await padMove(p, "tap");
  await padMove(p, "swipe-up");
  await expect.poll(async () => (await s()).heroes[0]!.jumps, { timeout: 5000 }).toBeGreaterThan(j0);
  await padMove(p, "swipe-down");
  const me = (await s()).heroes[0]!;
  expect(me.got!.hop).toBeGreaterThanOrEqual(2);
  expect(me.got!.act).toBeGreaterThanOrEqual(1);
  await p.screenshot({ path: "test-results/stepwell-pad-touchpad.png" });
  expect(await csp(tv)).toEqual([]);
});

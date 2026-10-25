import { expect, test } from "@playwright/test";
import { joinPhone } from "./helpers";
import { csp, expectLiteBudgets, joinTwo, platState, platTv, playToPodium, ready, startGame } from "./platformer";

const TIER = process.env.PLAT_TIER ?? "lite";
if (process.env.PLAT_GPU) test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });

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

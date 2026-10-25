import { expect, test } from "@playwright/test";
import { joinPhone } from "./helpers";
import { closeAll, csp, expectLiteBudgets, joinTwo, platState, platTv, playToPodium, ready, startGame } from "./platformer";

const TIER = process.env.PLAT_TIER ?? "lite";
if (process.env.PLAT_GPU) test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });
test.afterEach(async ({ browser }) => closeAll(browser));

test(`Monsoon Courier with buttons (${TIER}): two phones race the quick delivery to the podium`, async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await platTv(browser, `quality=${TIER}`);
  const [a, b] = await joinTwo(browser, code);
  await startGame(tv, "Monsoon Courier");
  await ready(tv, a, "Asha");
  await ready(tv, b, "Ravi");
  const s = platState(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 30_000 }).toMatch(/intro|play/);
  for (const label of ["JUMP", "RUN", "ACTION"]) await expect(a.locator(".game-pad .action", { hasText: label })).toBeVisible();
  await expect(a.locator('.game-pad[data-mode="buttons"] .arrow-right')).toBeVisible();
  await tv.screenshot({ path: `test-results/monsoon-intro-${TIER}.png` });
  await expect.poll(async () => (await s()).phase, { timeout: 15_000 }).toBe("play");
  let shot = false;
  const fps = await playToPodium(tv, [a, b], 150_000, async (st) => {
    if (!shot && st.phase === "play" && st.time > 4) {
      shot = true;
      await tv.screenshot({ path: `test-results/monsoon-play-${TIER}.png` });
      console.log(`monsoon ${st.tier}: draw calls ${st.calls}, triangles ${st.tris}, decoded ${st.decodedMB} MB, load ${st.loadMs} ms, fps ${st.fps}`);
      if (st.tier === "lite") expectLiteBudgets(st);
    }
  });
  const end = await s();
  expect(end.phase).toBe("podium");
  await expect(tv.locator("[data-award]").first()).toBeVisible({ timeout: 8000 });
  await tv.waitForTimeout(1500);
  await tv.screenshot({ path: `test-results/monsoon-podium-${TIER}.png` });
  expect(end.results).toHaveLength(2);
  await expect(a.getByText(/Fastest courier|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(b.getByText(/Fastest courier|You came/)).toBeVisible({ timeout: 15_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 25_000 });
  console.log(`monsoon ${TIER}: fps min ${Math.min(...fps)} median ${fps.sort((x, y) => x - y)[Math.floor(fps.length / 2)]}`);
  expect(await csp(tv)).toEqual([]);
});

for (const tier of ["lite", "high"] as const) {
  test(`Monsoon Courier renders in the ${tier} tier`, async ({ browser }) => {
    test.skip(!process.env.PLAT_SHOTS, "screenshots for review: PLAT_SHOTS=1");
    test.setTimeout(90_000);
    const { tv, code } = await platTv(browser, `quality=${tier}&mode=race`);
    const a = await joinPhone(browser, code, "Asha");
    await startGame(tv, "Monsoon Courier");
    await ready(tv, a, "Asha");
    const s = platState(tv);
    await expect.poll(async () => (await s()).phase, { timeout: 40_000 }).toBe("play");
    await playToPodium(tv, [a], 3500);
    const st = await s();
    console.log(`monsoon ${tier}: fps ${st.fps}, draw calls ${st.calls}, triangles ${st.tris}, decoded ${st.decodedMB} MB`);
    await tv.screenshot({ path: `test-results/monsoon-${tier}.png` });
    expect(st.tier).toBe(tier);
  });
}

test("Monsoon Courier loads in under 10 s on a normal home connection (10 Mbit/s, 40 ms)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await platTv(browser, "quality=lite&mode=race");
  const a = await joinPhone(browser, code, "Asha");
  const cdp = await tv.context().newCDPSession(tv);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: (10e6 / 8), uploadThroughput: (2e6 / 8) });
  const t0 = Date.now();
  await startGame(tv, "Monsoon Courier");
  await ready(tv, a, "Asha");
  const s = platState(tv);
  await expect.poll(async () => (await s()).phase ?? "", { timeout: 30_000 }).toMatch(/intro|play/);
  const total = Date.now() - t0;
  const st = await s();
  console.log(`monsoon load on 10 Mbit/s: assets ${st.loadMs} ms, start → level on screen ${total} ms (includes the get-ready screen)`);
  expect(st.loadMs).toBeLessThan(10_000);
  expect(total).toBeLessThan(15_000);
  expect(await csp(tv)).toEqual([]);
});

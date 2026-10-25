import { expect, test } from "@playwright/test";
import { joinPhone } from "./helpers";
import { closeAll, platState, platTv, playToPodium, ready, startGame } from "./platformer";

/**
 * Review screenshots of every level of the three kitplat games in the lite and high tiers (not part of the normal
 * run): PLAT_SHOTS=1, and PLAT_GPU=1 to give Chromium the machine's GPU for the high tier.
 */
if (process.env.PLAT_GPU) test.use({ launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } });
test.afterEach(async ({ browser }) => closeAll(browser));

const GAMES = [["Monsoon Courier", "monsoon"], ["Lantern Lane", "lantern"], ["Stepwell Secrets", "stepwell"]] as const;
for (const [title, slug] of GAMES) {
  for (const tier of ["lite", "high"] as const) {
    for (const level of [1, 2, 3]) {
      test(`${title} level ${level} in the ${tier} tier`, async ({ browser }) => {
        test.skip(!process.env.PLAT_SHOTS, "screenshots for review: PLAT_SHOTS=1");
        test.setTimeout(120_000);
        const { tv, code } = await platTv(browser, `quality=${tier}&mode=coop&level=${level}`, false);
        const a = await joinPhone(browser, code, "Asha");
        await startGame(tv, title);
        await ready(tv, a, "Asha");
        const s = platState(tv);
        await expect.poll(async () => (await s()).phase, { timeout: 40_000 }).toBe("play");
        await playToPodium(tv, [a], level === 3 ? 9000 : 5000);
        const st = await s();
        console.log(`${slug} L${level} ${tier}: fps ${st.fps}, draw calls ${st.calls}, triangles ${st.tris}, decoded ${st.decodedMB} MB, load ${st.loadMs} ms`);
        await tv.screenshot({ path: `test-results/shots/${slug}-L${level}-${tier}.png` });
        expect(st.tier).toBe(tier);
      });
    }
  }
}

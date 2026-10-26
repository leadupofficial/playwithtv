import { expect, test, type Browser, type Page } from "@playwright/test";
import { tvCode } from "./helpers";

/**
 * The cinematic foundation: every render tier of /tv/showroom loads its assets (sprite atlas + manifest, H.264
 * loop, GLB with embedded textures, HDR environment) with zero Content-Security-Policy violations and nothing
 * fetched from other origins; the lobby's Graphics chip and the power-host help work with the remote.
 */
type Dbg = { tier: string; setting: string; ready: boolean; view: string; loaded?: boolean; video?: boolean; fps?: number; calls?: number; error?: string };

async function watchedPage(browser: Browser) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const external: string[] = [];
  const failed: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    // the app's web fonts (fonts.googleapis.com, allowed by the CSP) are the only other origin
    if (!/^(data|blob):/.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) external.push(u);
  });
  page.on("requestfailed", (r) => { if (!/\.mp4/.test(r.url())) failed.push(`${r.url()} ${r.failure()?.errorText}`); }); // video range requests may be cancelled
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.url()} ${r.status()}`); });
  return { page, csp: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), external, failed };
}

const dbg = async (page: Page): Promise<Dbg> => JSON.parse((await page.locator("[data-showroom]").getAttribute("data-showroom", { timeout: 30_000 })) || "{}");

test("showroom: lite, high and ultra each load and render with zero CSP violations", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, csp, external, failed } = await watchedPage(browser);
  // GitHub's runners have no GPU: there only lite is loaded (high and ultra are checked on real machines)
  for (const tier of process.env.CI ? ["lite"] : ["lite", "high", "ultra"]) {
    await page.goto(`/tv/showroom?quality=${tier}`);
    await expect.poll(async () => { const d = await dbg(page); return d.error ?? (d.loaded && (d.fps ?? 0) > 0 ? "ok" : "loading"); }, { timeout: 90_000 }).toBe("ok");
    const d = await dbg(page);
    expect(d.tier).toBe(tier);
    expect(d.view).toBe(tier === "lite" ? "lite" : "realtime");
    if (tier === "lite") {
      // five sprites, one instanced draw call (stats refresh once a second)
      await expect.poll(async () => (await dbg(page)).calls, { timeout: 10_000 }).toBe(1);
      const video = page.locator("video[data-backdrop]");
      expect(await video.evaluate((v: HTMLVideoElement) => v.muted && v.loop && v.playsInline && !!v.poster)).toBe(true);
      // Playwright's open-source Chromium has no H.264 decoder (Chrome, Android WebView and TVs do): there the
      // poster stands in, which is exactly the fallback path; with a decoder the loop must really play
      const h264 = await video.evaluate((v: HTMLVideoElement) => v.canPlayType('video/mp4; codecs="avc1.4D401F"'));
      if (h264) await expect.poll(async () => (await dbg(page)).video, { timeout: 20_000 }).toBe(true);
      else test.info().annotations.push({ type: "video", description: "no H.264 in this Chromium build: poster fallback checked" });
      console.log("H.264 playable in this browser:", h264 || "no");
    } else {
      await expect.poll(async () => (await dbg(page)).calls ?? 0, { timeout: 10_000 }).toBeGreaterThan(3);
    }
    await page.screenshot({ path: test.info().outputPath(`showroom-${tier}.png`) });
    console.log(`showroom ${tier}:`, JSON.stringify(d));
  }
  expect(await csp()).toEqual([]);
  expect(external).toEqual([]);
  expect(failed).toEqual([]);
  await page.context().close(); // software WebGL is slow: stop rendering before the next test
});

test("showroom: the remote switches tiers (D-pad + OK) without a reload", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page, csp } = await watchedPage(browser);
  await page.goto("/tv/showroom?quality=lite");
  await expect.poll(async () => (await dbg(page)).loaded, { timeout: 60_000 }).toBe(true);
  await page.locator("[data-tier-tab=high]").focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => { const d = await dbg(page); return `${d.tier}/${d.view}/${d.loaded}`; }, { timeout: 60_000 }).toBe("high/realtime/true");
  await page.keyboard.press("ArrowLeft");   // spatial navigation moves focus to the Lite tab
  await page.keyboard.press("Enter");
  await expect.poll(async () => { const d = await dbg(page); return `${d.tier}/${d.loaded}`; }, { timeout: 60_000 }).toBe("lite/true");
  expect(await csp()).toEqual([]);
  await page.context().close();
});

test("lobby: the Graphics chip cycles Auto/Lite/High/Ultra and the lite tip opens the casting help", async ({ browser }) => {
  const { page, csp } = await watchedPage(browser);
  await page.goto("/tv");
  await tvCode(page);
  const chip = page.locator("[data-quality-setting]");
  await expect(chip).toHaveText(/Graphics: Auto \((Lite|High|Ultra)\)/, { timeout: 15_000 });
  // headless Chromium renders WebGL in software (SwiftShader): detection must say lite and offer the tip
  await expect(chip).toHaveAttribute("data-quality", "lite");
  await expect(page.locator("[data-quality-tip]")).toBeVisible();
  for (const want of ["lite", "high", "ultra", "auto"]) {
    await chip.click();
    await expect(chip).toHaveAttribute("data-quality-setting", want);
  }
  await chip.click(); // Lite again: it is saved on this device
  await page.reload();
  await expect(page.locator("[data-quality-setting]")).toHaveAttribute("data-quality-setting", "lite");
  await page.locator("[data-quality-setting]").click(); // High
  await page.locator("[data-quality-setting]").click(); // Ultra
  await page.locator("[data-quality-setting]").click(); // Auto
  await page.locator("[data-quality-tip]").click();
  await expect(page).toHaveURL(/\/tv\/hosting$/);
  await expect(page.getByRole("heading", { name: "Console-quality graphics" })).toBeVisible();
  await expect(page.getByText(/Cast tab/)).toBeVisible();
  expect(await csp()).toEqual([]);
});

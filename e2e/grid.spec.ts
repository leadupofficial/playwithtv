import { expect, test, type Browser, type Page } from "@playwright/test";
import { joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

/**
 * The four kitgrid titles (Glowworm Grove, Skyline Stacker, Comet Kitty, Buzz Field): each loads its atlas,
 * runs practice → map → story → play → result on a real TV page, and the quick (?quick=1) level is won from the phone.
 */

async function tvPage(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  tv.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_CONNECTION|WebSocket/.test(m.text())) errors.push(m.text()); });
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv), errors };
}
const grid = (tv: Page) => () => tv.locator("[data-grid]").getAttribute("data-grid").then((s) => JSON.parse(s || "{}"));

const CASES = [
  { name: "Glowworm Grove", practice: ["btn:▲ Up", "btn:▶ Right", "btn:▼ Down", "btn:◀ Left"], play: [] as string[], ok: "▲ Up" },
  { name: "Skyline Stacker", practice: ["btn:◀ Left", "btn:▶ Right", "btn:⟳ Turn", "btn:⤓ Drop"], play: ["⤓ Drop"], ok: "⟳ Turn" },
  { name: "Comet Kitty", practice: ["btn:▲ Up", "btn:▶ Right", "btn:▼ Down", "btn:◀ Left"], play: [], ok: "▲ Up" },
  { name: "Buzz Field", practice: ["btn:▶ Right", "btn:▼ Down", "btn:🌱 Mow", "btn:🚩 Flag"], play: ["🌱 Mow"], ok: "🌱 Mow" },
];

for (const c of CASES) {
  test(`${c.name}: shelf filter, practice, story, quick level won, stars saved`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { tv, code, errors } = await tvPage(browser);
    const ana = await joinPhone(browser, code, "Ana");

    // the lobby's Single-player shelf shows the title and hides multiplayer-only games
    await tv.locator(".shelf", { hasText: "Single-player" }).click();
    await expect(tv.locator(".game-card", { hasText: c.name })).toBeVisible();
    await expect(tv.locator(".game-card", { hasText: "Air Hockey" })).toHaveCount(0);
    await tv.locator(".game-card", { hasText: c.name }).click();
    await tv.getByRole("button", { name: new RegExp(`Start ${c.name}`) }).click();

    await practiseUntilReady(tv, ana, "Ana", c.practice as never);
    const g = grid(tv);
    await expect.poll(async () => (await g()).phase, { timeout: 15_000 }).toBe("map");
    await tv.screenshot({ path: `test-results/grid-${c.name.replace(/ /g, "-")}-map.png` });
    await press(ana, "▶ Play"); // map → story (the phone relabels the OK button on the map)
    await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("story");
    await press(ana, "▶ Start"); // story → play
    await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("play");
    await tv.waitForTimeout(400);
    await tv.screenshot({ path: `test-results/grid-${c.name.replace(/ /g, "-")}-play.png` });
    for (const label of c.play) await press(ana, label);

    await expect.poll(async () => (await g()).phase, { timeout: 30_000 }).toBe("result");
    const st = await g();
    expect(st.outcome?.won ?? st.won).toBeTruthy();
    await tv.screenshot({ path: `test-results/grid-${c.name.replace(/ /g, "-")}-result.png` });
    const saved = await tv.evaluate((id) => localStorage.getItem(`pwtv.grid.${id}`), c.name.toLowerCase().replace(/ /g, "-"));
    expect(JSON.parse(saved ?? "{}").stars?.[0]).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

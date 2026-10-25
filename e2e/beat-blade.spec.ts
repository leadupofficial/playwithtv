import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

type Next = { t: number; dir: "u" | "d" | "l" | "r" | "o"; lane: number };
type Play = { t?: number; start?: number; next?: Next[]; runners?: Array<{ score: number; hits: Record<string, number>; misses: number }> };
type Menu = { phase?: string; cursor?: number; diff?: string; stars?: number[] };

const LABEL = { u: "Cut up", d: "Cut down", l: "Cut left", r: "Cut right", o: "Cut down" } as const;
const FLICK = { u: "flick-up", d: "flick-down", l: "flick-left", r: "flick-right", o: "flick-down" } as const;

async function beatTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const menuOf = (tv: Page) => async (): Promise<Menu> =>
  JSON.parse((await tv.locator("[data-beat]").getAttribute("data-beat", { timeout: 2000 }).catch(() => null)) || "{}");
const playOf = (tv: Page) => async (): Promise<Play> =>
  JSON.parse((await tv.locator("[data-beat]").getAttribute("data-beat-play", { timeout: 2000 }).catch(() => null)) || "{}");

/**
 * Plays the song: for each upcoming block, waits on the TV's own clock until just before its beat, then cuts
 * the way its arrow points. Returns how many cuts were tried.
 */
async function playSong(tv: Page, cut: (dir: Next["dir"]) => Promise<void>, lead: number, max = 12) {
  const play = playOf(tv), menu = menuOf(tv);
  let tried = 0;
  let last = -1;
  while (tried < max && (await menu()).phase === "play") {
    const s = await play();
    const n = s.next?.find((x) => x.t > last);
    if (!n || s.start === undefined) { await tv.waitForTimeout(60); continue; }
    const tvNow = await tv.evaluate(() => performance.now());
    const wait = n.t - (tvNow - s.start) - lead;
    if (wait < -60) { last = n.t; continue; } // too late for this one
    if (wait > 0) await tv.waitForTimeout(wait);
    last = n.t;
    await cut(n.dir);
    if (++tried === 3) await tv.screenshot({ path: "test-results/beat-play-mid.png" });
  }
  return tried;
}

test("Beat Blade with buttons: pick a song, cut blocks on the beat, clear it and earn stars", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await beatTv(browser);
  const phone = await joinPhone(browser, code, "Dev", { "Beat Blade": "buttons" });
  await tv.locator(".game-card", { hasText: "Beat Blade" }).click();
  await tv.getByRole("button", { name: /Start Beat Blade/ }).click();
  await practiseUntilReady(tv, phone, "Dev", ["btn:Cut up", "btn:Cut down", "btn:Cut left", "btn:Cut right"]);
  const menu = menuOf(tv);
  // quick mode skips calibration and starts on Easy at the first song
  await expect.poll(async () => (await menu()).phase, { timeout: 15_000 }).toBe("menu");
  expect(await menu()).toMatchObject({ cursor: 0, diff: "easy" });
  await expect(tv.locator(".beat-dname", { hasText: "Harbour Lights" })).toBeVisible();
  await tv.screenshot({ path: "test-results/beat-menu.png" });
  // the next song is locked until the first is cleared
  await press(phone, "Cut right");
  await expect.poll(async () => (await menu()).cursor).toBe(1);
  await press(phone, "Cut down");
  await expect(phone.getByText(/Clear the song before this one/)).toBeVisible({ timeout: 5000 });
  await press(phone, "Cut left");
  await expect.poll(async () => (await menu()).cursor).toBe(0);
  await press(phone, "Cut down");
  await expect.poll(async () => (await menu()).phase, { timeout: 5000 }).toBe("play");

  // a button cut counts when it arrives, less the default relay delay (85 ms): press a little after the beat
  const tried = await playSong(tv, (d) => press(phone, LABEL[d]), -30);
  await tv.screenshot({ path: "test-results/beat-play.png" });
  const p = await playOf(tv)();
  const r = p.runners?.[0];
  console.log("beat-blade buttons", tried, JSON.stringify(r));
  const hits = (r?.hits.perfect ?? 0) + (r?.hits.great ?? 0) + (r?.hits.good ?? 0);
  expect(hits).toBeGreaterThanOrEqual(Math.ceil(tried / 2));
  expect(r!.score).toBeGreaterThan(0);

  await expect.poll(async () => (await menu()).phase, { timeout: 40_000 }).toBe("result");
  await expect(tv.getByText(/First Pulse cleared!/)).toBeVisible();
  await tv.screenshot({ path: "test-results/beat-result.png" });
  expect((await menu()).stars?.[0]).toBeGreaterThanOrEqual(1);
  // ▼ goes on to the next song, now open
  await press(phone, "Cut down");
  await expect.poll(async () => (await menu())).toMatchObject({ phase: "menu", cursor: 1 });
});

test("Beat Blade in motion mode: wrist flicks cut, timed by the phone's swing stamp", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await beatTv(browser);
  const phone = await joinPhone(browser, code, "Dev", { "Beat Blade": "motion" });
  await tv.locator(".game-card", { hasText: "Beat Blade" }).click();
  await tv.getByRole("button", { name: /Start Beat Blade/ }).click();
  await practiseUntilReady(tv, phone, "Dev", ["flick-up", "flick-down", "flick-left", "flick-right"]);
  const menu = menuOf(tv);
  await expect.poll(async () => (await menu()).phase, { timeout: 15_000 }).toBe("menu");
  await gesture(phone, "flick-down");
  await expect.poll(async () => (await menu()).phase, { timeout: 8000 }).toBe("play");
  // a flick peaks ~80 ms into its burst: start it that much before the beat
  const fire = (d: Next["dir"]) => phone.evaluate(([dir]) => {
    const D: Record<string, { x: number; y: number; z: number }> = { "flick-up": { x: 0, y: 1, z: 0 }, "flick-down": { x: 0, y: -1, z: 0 }, "flick-left": { x: -1, y: 0, z: 0 }, "flick-right": { x: 1, y: 0, z: 0 } };
    (window as unknown as { __sensor: { burst: unknown } }).__sensor.burst = { dir: D[dir!], peak: 18, t0: performance.now(), ms: 160 };
  }, [FLICK[d]] as const).then(() => phone.waitForTimeout(260));
  const tried = await playSong(tv, fire, 30, 8);
  const r = (await playOf(tv)()).runners?.[0];
  console.log("beat-blade motion", tried, JSON.stringify(r));
  const hits = (r?.hits.perfect ?? 0) + (r?.hits.great ?? 0) + (r?.hits.good ?? 0);
  expect(hits).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await menu()).phase, { timeout: 40_000 }).toBe("result");
});

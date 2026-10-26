import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

type Move = "up" | "down" | "left" | "right" | "punch" | "pull" | "twist-l" | "twist-r" | "shimmy";
type Next = { t: number; move: Move };
type Play = { t?: number; start?: number; next?: Next[]; dancers?: Array<{ score: number; counts: Record<string, number> }> };
type Menu = { phase?: string; cursor?: number; diff?: string; stars?: number[] };

/** Button labels per move (buttons mode). */
const LABEL: Record<Move, string> = {
  up: "Up", down: "Down", left: "Left", right: "Right", punch: "Punch", pull: "Pull", "twist-l": "Twist ⟲", "twist-r": "Twist ⟳", shimmy: "Shimmy",
};
/** Sensor bursts the fake phone can make (twists and shakes are left out: the bot skips those moves). */
const BURST: Partial<Record<Move, { x: number; y: number; z: number }>> = {
  up: { x: 0, y: 1, z: 0 }, down: { x: 0, y: -1, z: 0 }, left: { x: -1, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 },
  punch: { x: 0, y: 0, z: -1 }, pull: { x: 0, y: 0, z: 1 },
};

// Groove Party is a prototype, hidden from TVs (playable: false in catalog.ts) until it passes on real phones.
// To run these: set playable: true for "groove-party" in packages/protocol/src/catalog.ts, then GROOVE=1 pnpm e2e.
test.skip(!process.env.GROOVE, "Groove Party is hidden until it passes on real phones");

async function grooveTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const menuOf = (tv: Page) => async (): Promise<Menu> =>
  JSON.parse((await tv.locator("[data-groove]").getAttribute("data-groove", { timeout: 2000 }).catch(() => null)) || "{}");
const playOf = (tv: Page) => async (): Promise<Play> =>
  JSON.parse((await tv.locator("[data-groove]").getAttribute("data-groove-play", { timeout: 2000 }).catch(() => null)) || "{}");

/** Dances the song: waits on the TV's clock until just before each move, then does it. Returns moves tried. */
async function danceSong(tv: Page, act: (m: Move) => Promise<void>, lead: number, can: (m: Move) => boolean) {
  const play = playOf(tv), menu = menuOf(tv);
  let tried = 0, last = -1;
  while ((await menu()).phase === "play") {
    const s = await play();
    const n = s.next?.find((x) => x.t > last && can(x.move));
    if (!n || s.start === undefined) { await tv.waitForTimeout(60); continue; }
    const wait = n.t - ((await tv.evaluate(() => performance.now())) - s.start) - lead;
    if (wait < -60) { last = n.t; continue; }
    if (wait > 0) await tv.waitForTimeout(wait);
    last = n.t;
    await act(n.move);
    if (++tried === 2) await tv.screenshot({ path: "test-results/groove-play.png" });
  }
  return tried;
}

const scored = (c?: Record<string, number>) => (c?.perfect ?? 0) + (c?.super ?? 0) + (c?.good ?? 0);

test("Groove Party with buttons: pick a song, dance it, earn stars, next song opens", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await grooveTv(browser);
  const phone = await joinPhone(browser, code, "Dev", { "Groove Party": "buttons" });
  await tv.locator(".game-card", { hasText: "Groove Party" }).click();
  await tv.getByRole("button", { name: /Start Groove Party/ }).click();
  await practiseUntilReady(tv, phone, "Dev", ["btn:Up", "btn:Punch", "btn:Right"]);
  const menu = menuOf(tv);
  await expect.poll(async () => (await menu()).phase, { timeout: 15_000 }).toBe("menu");
  expect(await menu()).toMatchObject({ cursor: 0, diff: "easy" });
  await expect(tv.locator(".groove-cname", { hasText: "Disco Downtown" })).toBeVisible();
  await tv.screenshot({ path: "test-results/groove-menu.png" });
  // the second song is locked until the first is cleared
  await press(phone, "Right");
  await expect.poll(async () => (await menu()).cursor).toBe(1);
  await press(phone, "Punch");
  // a locked song never starts (the phone's toast is only on screen for 2.5 s, so it is a soft check)
  await tv.waitForTimeout(800);
  expect((await menu()).phase).toBe("menu");
  console.log("groove locked toast seen:", await phone.getByText(/Clear the song before this one/).isVisible());
  await press(phone, "Left");
  await expect.poll(async () => (await menu()).cursor).toBe(0);
  await press(phone, "Punch");
  await expect.poll(async () => (await menu()).phase, { timeout: 5000 }).toBe("play");

  // a button counts when it arrives, less the relay delay (85 ms): press just after the beat
  const tried = await danceSong(tv, (m) => press(phone, LABEL[m]), -30, () => true);
  await expect.poll(async () => (await menu()).phase, { timeout: 20_000 }).toBe("result");
  await expect(tv.getByText(/Mirror Ball: the crowd loved it!/)).toBeVisible();
  await tv.screenshot({ path: "test-results/groove-result.png" });
  expect(tried).toBeGreaterThanOrEqual(5);
  expect((await menu()).stars?.[0]).toBeGreaterThanOrEqual(1);
  await press(phone, "Punch");
  await expect.poll(async () => await menu()).toMatchObject({ phase: "menu", cursor: 1 });
});

test("Groove Party in motion mode: an Android phone and an iPhone dance the same moves, timed by each phone's stamp, and hit IN SYNC", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await grooveTv(browser);
  const a = await joinPhone(browser, code, "Ana", { "Groove Party": "motion" });
  // Ben is on an iPhone: Safari's motion permission prompt and its flipped acceleration signs
  const b = await joinPhone(browser, code, "Ben", { "Groove Party": "motion" }, { iphone: true });
  expect(await b.evaluate(() => (window as unknown as { __askedMotion: number }).__askedMotion)).toBeGreaterThanOrEqual(1);
  await tv.locator(".game-card", { hasText: "Groove Party" }).click();
  await tv.getByRole("button", { name: /Start Groove Party/ }).click();
  await Promise.all([
    practiseUntilReady(tv, a, "Ana", ["flick-up", "push", "flick-right"]),
    practiseUntilReady(tv, b, "Ben", ["flick-up", "push", "flick-right"]),
  ]);
  const menu = menuOf(tv);
  await expect.poll(async () => (await menu()).phase, { timeout: 15_000 }).toBe("menu");
  // punch to start; on a loaded machine one burst can be sampled too thinly, so punch again like a player would
  for (let i = 0; i < 4 && (await menu()).phase === "menu"; i++) {
    await gesture(a, "push");
    await expect.poll(async () => (await menu()).phase, { timeout: 2500 }).toBe("play").catch(() => {});
  }
  expect((await menu()).phase).toBe("play");
  // both dancers move together; a burst peaks ~80 ms in, so start it that much before the beat
  const fire = (m: Move) => Promise.all([a, b].map((p) => p.evaluate(([d]) => {
    (window as unknown as { __sensor: { burst: unknown } }).__sensor.burst = { dir: d, peak: 18, t0: performance.now(), ms: 160 };
  }, [BURST[m]!] as const))).then(() => tv.waitForTimeout(250));
  const tried = await danceSong(tv, fire, 80, (m) => m in BURST);
  const last = await playOf(tv)();
  console.log("groove motion", tried, JSON.stringify(last.dancers));
  await expect.poll(async () => (await menu()).phase, { timeout: 20_000 }).toBe("result");
  await tv.screenshot({ path: "test-results/groove-result-sync.png" });
  const [ana, ben] = last.dancers ?? [];
  expect(scored(ana?.counts)).toBeGreaterThanOrEqual(2);
  expect(scored(ben?.counts)).toBeGreaterThanOrEqual(2);
  await expect(tv.locator(".groove-res", { hasText: /in sync/ }).first()).toBeVisible();
});

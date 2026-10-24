import { expect, devices, type Browser, type Page } from "@playwright/test";

export const PHONE = devices["Pixel 7 landscape"];

/** Screen-axis vectors (x right, y up, z out of the screen). */
export type V = { x: number; y: number; z: number };
const G = 9.81;
const rad = (d: number) => (d * Math.PI) / 180;
/** Phone held upright like a steering wheel, turned `roll`° right and tipped `pitch`° (top edge away). */
export const upright = (roll = 0, pitch = 0): V => ({ x: -Math.sin(rad(roll)) * Math.cos(rad(pitch)) * G, y: Math.cos(rad(roll)) * Math.cos(rad(pitch)) * G, z: Math.sin(rad(pitch)) * G });
/** Phone lying flat (screen up, top edge to the TV), tilted right by `roll`° and top-edge-down by `pitch`°. */
export const flat = (roll = 0, pitch = 0): V => ({ x: -Math.sin(rad(roll)) * G, y: -Math.sin(rad(pitch)) * Math.cos(rad(roll)) * G, z: Math.cos(rad(pitch)) * Math.cos(rad(roll)) * G });

/**
 * A synthetic motion sensor inside the phone page: it emits DeviceMotion events at ~60 Hz for the current
 * pose (like a real phone, which never stops reporting), plus short movement bursts for gestures.
 * Vectors are given in screen axes and converted to device axes for the emulated landscape orientation.
 */
function installSensor() {
  type Vec = { x: number; y: number; z: number };
  const toDevice = (v: Vec): Vec => {
    const a = (((screen.orientation?.angle ?? 0) % 360) + 360) % 360;
    if (a === 90) return { x: v.y, y: -v.x, z: v.z };
    if (a === 180) return { x: -v.x, y: -v.y, z: v.z };
    if (a === 270) return { x: -v.y, y: v.x, z: v.z };
    return v;
  };
  const w = window as unknown as { __sensor: { pose: Vec; burst: { dir: Vec; peak: number; t0: number; ms: number } | null } };
  w.__sensor = { pose: { x: 0, y: 9.81, z: 0 }, burst: null };
  setInterval(() => {
    const s = w.__sensor;
    let lin = { x: 0, y: 0, z: 0 };
    if (s.burst) {
      const p = (performance.now() - s.burst.t0) / s.burst.ms;
      if (p >= 1) s.burst = null;
      else {
        const a = Math.sin(p * Math.PI * 2) * s.burst.peak;
        lin = { x: s.burst.dir.x * a, y: s.burst.dir.y * a, z: s.burst.dir.z * a };
      }
    }
    const g = toDevice({ x: s.pose.x + lin.x, y: s.pose.y + lin.y, z: s.pose.z + lin.z });
    const l = toDevice(lin);
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", {
      accelerationIncludingGravity: g, acceleration: l, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16,
    }));
  }, 16);
}

export type Mode = "buttons" | "motion" | "hybrid" | "touchpad";

/** Opens a phone with the synthetic sensor, joins with the code and taps the controller's start gate. */
export async function joinPhone(browser: Browser, code: string, name: string, modes: Record<string, Mode> = {}) {
  const page = await newPhonePage(browser, modes);
  await page.goto("/join");
  await page.getByLabel("TV code").fill(code);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join as guest" }).click();
  await startController(page);
  return page;
}

export async function newPhonePage(browser: Browser, modes: Record<string, Mode> = {}) {
  const ctx = await browser.newContext({ ...PHONE, ignoreHTTPSErrors: true });
  await ctx.grantPermissions(["accelerometer", "gyroscope"]); // what the user allows on a real phone
  await ctx.addInitScript(installSensor);
  // preset control modes per game title (what a player would pick with the mode chip)
  if (Object.keys(modes).length) await ctx.addInitScript((m) => localStorage.setItem("pwtv.controls", JSON.stringify(m)), modes);
  return ctx.newPage();
}

/** Taps an on-screen action button by its label (buttons / hybrid / touchpad modes). */
export async function press(page: Page, label: string | RegExp) {
  await page.locator(".game-pad .action", { hasText: label }).first().dispatchEvent("pointerdown", {}, { timeout: 5000 });
  await page.waitForTimeout(120);
}

/** Holds an on-screen arrow (◀ ▶ ▲ ▼) or hold-button for `ms`. */
export async function hold(page: Page, selector: string, ms: number) {
  const el = page.locator(`.game-pad ${selector}`).first();
  await el.dispatchEvent("pointerdown", { pointerId: 7 }, { timeout: 5000 });
  await page.waitForTimeout(ms);
  await el.dispatchEvent("pointerup", { pointerId: 7 });
}

export async function startController(page: Page) {
  await page.getByRole("button", { name: /Tap to start your controller/ }).click();
  await expect(page.locator(".status-bar").first()).toBeVisible();
}

/** Holds the phone in a pose (the sensor keeps reporting it until changed). */
export async function pose(page: Page, v: V, settleMs = 400) {
  await page.evaluate((p) => { (window as unknown as { __sensor: { pose: V } }).__sensor.pose = p; }, v);
  await page.waitForTimeout(settleMs);
}

const DIRS: Record<string, V> = {
  push: { x: 0, y: 0, z: -1 }, pull: { x: 0, y: 0, z: 1 }, "flick-up": { x: 0, y: 1, z: 0 },
  "flick-down": { x: 0, y: -1, z: 0 }, "flick-left": { x: -1, y: 0, z: 0 }, "flick-right": { x: 1, y: 0, z: 0 },
};

/** A deliberate gesture (relative to an upright hold): a 160 ms movement burst, then settling. */
export async function gesture(page: Page, kind: keyof typeof DIRS, peak = 18) {
  await page.evaluate(([dir, p]) => {
    (window as unknown as { __sensor: { burst: unknown } }).__sensor.burst = { dir, peak: p, t0: performance.now(), ms: 160 };
  }, [DIRS[kind]!, peak] as const);
  await page.waitForTimeout(500);
}

/** The TV's join code, once it has arrived (the page shows a placeholder until then). */
export async function tvCode(tv: Page) {
  const el = tv.getByLabel("Join code");
  await expect(el).toHaveText(/^[A-Z2-9]{5}$/, { timeout: 15_000 });
  return (await el.textContent())!.trim();
}

/**
 * Waits for the TV's get-ready screen to show this player as ready. `moves` are gestures (motion mode) or
 * "btn:LABEL" to press an on-screen button (buttons / hybrid modes).
 */
export async function practiseUntilReady(tv: Page, phone: Page, name: string, moves: Array<keyof typeof DIRS | `btn:${string}` | `pad:${PadMove}`>) {
  const card = tv.locator(`.tut-card[data-player="${name}"]`);
  // "over" = the game itself is on screen: not the lobby, not the get-ready screen, not still loading the game
  const tutorialGone = async () =>
    (await tv.locator(".lobby, [data-tutorial]").count()) === 0 && (await tv.getByText("Loading game…").count()) === 0;
  // a buttons/touchpad player is ready at once, so in quick mode the get-ready screen may already be over
  await expect.poll(async () => (await card.count()) > 0 || (await tutorialGone()), { timeout: 15_000 }).toBe(true);
  if (await tutorialGone()) return;
  await expect.poll(async () => (await tutorialGone()) || /✓/.test((await card.textContent().catch(() => "")) ?? ""), { timeout: 10_000 }).toBe(true);
  for (const m of moves) {
    if (await tutorialGone()) return;
    if (m.startsWith("btn:")) await press(phone, m.slice(4));
    else if (m.startsWith("pad:")) await padMove(phone, m.slice(4) as PadMove);
    else await gesture(phone, m as keyof typeof DIRS);
  }
  await expect.poll(async () => (await tutorialGone()) || /ready/.test((await card.getAttribute("class").catch(() => "")) ?? ""), { timeout: 10_000 }).toBe(true);
}

// ---- touchpad mode: a finger on `.game-pad .touchpad` (pad axes: x right, y up, both in [-1, 1]) ----

/** Page coordinates for a point in touchpad axes. */
export async function padPoint(page: Page, x: number, y: number) {
  const box = (await page.locator(".game-pad .touchpad").boundingBox({ timeout: 5000 }))!;
  const c = (v: number) => Math.max(-0.98, Math.min(0.98, v));
  return { x: box.x + ((c(x) + 1) / 2) * box.width, y: box.y + ((1 - c(y)) / 2) * box.height };
}

/** Drags a finger across the touchpad from one point to another over `ms` (a quick, long drag is also a swipe). */
export async function padDrag(page: Page, from: [number, number], to: [number, number], ms = 200, steps = 8) {
  const a = await padPoint(page, from[0], from[1]);
  const b = await padPoint(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
}

/** A quick tap on the touchpad. */
export async function padTap(page: Page, x = 0, y = 0) {
  const p = await padPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}

export type PadMove = "tap" | "swipe-up" | "swipe-down" | "swipe-left" | "swipe-right";
const SWIPES: Record<Exclude<PadMove, "tap">, [[number, number], [number, number]]> = {
  "swipe-up": [[0, -0.6], [0, 0.6]], "swipe-down": [[0, 0.6], [0, -0.6]], "swipe-left": [[0.6, 0], [-0.6, 0]], "swipe-right": [[-0.6, 0], [0.6, 0]],
};
/** A tap or a swipe on the touchpad. */
export async function padMove(page: Page, m: PadMove) {
  if (m === "tap") return padTap(page);
  const [from, to] = SWIPES[m];
  await padDrag(page, from, to, 120, 4);
  await page.waitForTimeout(150);
}

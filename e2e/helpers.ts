import { expect, devices, type Browser, type Page } from "@playwright/test";

export const PHONE = devices["Pixel 7 landscape"];
/** An iPhone for the phone side: Safari's user agent, so the controller takes its iPhone paths. */
export const IPHONE = devices["iPhone 15 landscape"];

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
function installSensor(ios = false) {
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
  // iPhone Safari: motion needs a permission prompt from a tap, and acceleration comes with the opposite sign
  const sign = ios ? -1 : 1;
  if (ios) {
    (window as unknown as { __askedMotion: number }).__askedMotion = 0;
    Object.defineProperty(DeviceMotionEvent, "requestPermission", {
      value: async () => { (window as unknown as { __askedMotion: number }).__askedMotion++; return "granted"; }, configurable: true,
    });
  }
  const flip = (v: Vec): Vec => ({ x: sign * v.x, y: sign * v.y, z: sign * v.z });
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
    const g = flip(toDevice({ x: s.pose.x + lin.x, y: s.pose.y + lin.y, z: s.pose.z + lin.z }));
    const l = flip(toDevice(lin));
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", {
      accelerationIncludingGravity: g, acceleration: l, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16,
    }));
  }, 16);
}

export type Mode = "buttons" | "motion" | "hybrid" | "touchpad";

/** Opens a phone with the synthetic sensor, joins with the code and taps the controller's start gate. */
export async function joinPhone(browser: Browser, code: string, name: string, modes: Record<string, Mode> = {}, opts: { iphone?: boolean } = {}) {
  const page = await newPhonePage(browser, modes, opts);
  await page.goto("/join");
  await page.getByLabel("TV code").fill(code);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join as guest" }).click();
  await startController(page);
  return page;
}

export async function newPhonePage(browser: Browser, modes: Record<string, Mode> = {}, opts: { iphone?: boolean } = {}) {
  const { defaultBrowserType: _, ...device } = opts.iphone ? IPHONE : PHONE;
  const ctx = await browser.newContext({ ...device, ignoreHTTPSErrors: true });
  await ctx.grantPermissions(["accelerometer", "gyroscope"]); // what the user allows on a real phone
  await ctx.addInitScript(installSensor, !!opts.iphone);
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
  const ready = async () => (await tutorialGone()) || /ready/.test((await card.getAttribute("class").catch(() => "")) ?? "");
  // On a loaded machine the phone page can skip frames during a 160 ms motion burst, so the move is sampled too
  // thinly to count. Like a real player, try the moves again (up to three rounds) rather than wait on a lost one.
  for (let round = 0; round < 3 && !(await ready()); round++) {
    for (const m of moves) {
      if (await ready()) return;
      if (m.startsWith("btn:")) await press(phone, m.slice(4));
      else if (m.startsWith("pad:")) await padMove(phone, m.slice(4) as PadMove);
      else await gesture(phone, m as keyof typeof DIRS);
    }
    await expect.poll(ready, { timeout: 4_000 }).toBe(true).catch(() => undefined);
  }
  await expect.poll(ready, { timeout: 10_000 }).toBe(true);
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
  await padDrag(page, from, to, 80, 2); // few steps: each one is a browser round trip, slow on a loaded machine
  await page.waitForTimeout(150);
}

/** Holds an on-screen action button (a `hold` action, e.g. a charge button) by its label for `ms`. */
export async function holdAction(page: Page, label: string | RegExp, ms: number) {
  const el = page.locator(".game-pad .action", { hasText: label }).first();
  await el.dispatchEvent("pointerdown", { pointerId: 9 }, { timeout: 5000 });
  await page.waitForTimeout(ms);
  await el.dispatchEvent("pointerup", { pointerId: 9 });
  await page.waitForTimeout(120);
}

/** A finger stroke on the touchpad between two pad points: quick (≤ 250 ms) is a swipe, slow is a drag. */
export async function stroke(page: Page, from: [number, number], to: [number, number], ms = 120) {
  const a = await padPoint(page, ...from), b = await padPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const steps = Math.max(2, Math.round(ms / 40));
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/**
 * Touchpad mode: a quick drag across the pad, in pad coordinates (x right, y up, -1…1), like a real swipe.
 * The pointer events are fired inside the page on a timer, so the swipe takes `ms` even on a busy machine.
 */
export async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms = 150) {
  await page.locator(".game-pad .touchpad").first().evaluate((el, [f, t, dur]) => new Promise<void>((done) => {
    const r = el.getBoundingClientRect();
    const at = (p: { x: number; y: number }) => ({ clientX: r.left + ((p.x + 1) / 2) * r.width, clientY: r.top + ((1 - p.y) / 2) * r.height });
    const fire = (type: string, p: { x: number; y: number }) =>
      el.dispatchEvent(new PointerEvent(type, { ...at(p), pointerId: 9, pointerType: "touch", isPrimary: true, bubbles: true }));
    const steps = 5;
    fire("pointerdown", f);
    let i = 0;
    const id = setInterval(() => {
      i++;
      const p = { x: f.x + ((t.x - f.x) * i) / steps, y: f.y + ((t.y - f.y) * i) / steps };
      fire("pointermove", p);
      if (i >= steps) {
        clearInterval(id);
        fire("pointerup", t);
        done();
      }
    }, dur / steps);
  }), [from, to, ms] as const);
  await page.waitForTimeout(150);
}

/**
 * Does `act` until `done` holds, up to `tries` times. For player input whose effect is checked on the TV: on a
 * loaded machine (CI) a page can drop the frames a short gesture or drag lives in, and a real player would simply
 * do it again. A lost input is retried; an input that never works still fails.
 */
export async function retryUntil(act: () => Promise<unknown>, done: () => Promise<boolean>, tries = 3, waitMs = 5000, state?: () => Promise<unknown>) {
  for (let i = 0; i < tries; i++) {
    await act();
    const ok = await expect.poll(done, { timeout: waitMs }).toBe(true).then(() => true, () => false);
    if (ok) return;
  }
  throw new Error(`no effect after ${tries} tries${state ? `; state: ${JSON.stringify(await state())}` : ""}`);
}

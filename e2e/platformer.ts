/**
 * Shared e2e helpers for the kitplat platformers (Monsoon Courier, Lantern Lane, Stepwell Secrets): a TV page that
 * records CSP violations, the debug state (`data-plat`), and phone thumbs that hold ▶ (and RUN) while tapping JUMP.
 */
import { expect, type Browser, type Page } from "@playwright/test";
import { holdAction, joinPhone, practiseUntilReady, tvCode } from "./helpers";

export type PlatHero = { name: string; x: number; y: number; vx: number; state: string; down: string; finished: boolean; place: number; score: number; gems: number;
  hearts: number; jumps: number; stomps: number; falls: number; got: { jump: number; hop: number; act: number; run: number } | null };
export type PlatDbg = { game: string; phase: string; time: number; level: number; levels: number; mode: string; clock: number; fps: number; calls: number; tris: number;
  decodedMB: number; loadMs: number; tier: string; res: string; heroes: PlatHero[]; boss: { hp: number; awake: boolean; dead: boolean } | null;
  results?: Array<{ playerId: string; score: number; place: number }> };

export async function platTv(browser: Browser, query: string, quick = true) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  tv.on("pageerror", (e) => console.log(`[tv page error] ${e.stack ?? e.message}`));
  await tv.goto(`/tv?${quick ? "quick=1&" : ""}${query}`);
  return { tv, code: await tvCode(tv) };
}

export const platState = (tv: Page) => async (): Promise<PlatDbg> => JSON.parse((await tv.locator("[data-plat]").getAttribute("data-plat").catch(() => "")) || "{}");
export const csp = (tv: Page) => tv.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

export async function startGame(tv: Page, title: string) {
  await tv.locator(".game-card", { hasText: title }).click();
  await tv.getByRole("button", { name: new RegExp(`Start ${title}`) }).click();
}

/** Get-ready screen: a buttons phone practises JUMP (a hold button: press and release). */
export async function ready(tv: Page, phone: Page, name: string) {
  // the phone shows the game's pad once the TV has loaded the game (slower on a slow connection)
  await expect(phone.locator(".game-pad .action", { hasText: "JUMP" }).first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
  await holdAction(phone, "JUMP", 120).catch(() => undefined);
  await practiseUntilReady(tv, phone, name, []).catch(async (e) => {
    if (!(await tv.locator("[data-plat]").count())) throw e;
  });
}

const down = (p: Page, sel: string, id: number) => p.locator(`.game-pad ${sel}`).first().dispatchEvent("pointerdown", { pointerId: id }, { timeout: 1000 }).catch(() => undefined);
const up = (p: Page, sel: string, id: number) => p.locator(`.game-pad ${sel}`).first().dispatchEvent("pointerup", { pointerId: id }, { timeout: 1000 }).catch(() => undefined);

/** Buttons-mode thumbs: hold ▶ (and RUN) for the whole run; jump() taps JUMP for `ms`. */
export async function thumbs(phone: Page, run = true) {
  await down(phone, ".arrow-right", 7);
  if (run) await down(phone, '.action:has-text("RUN")', 11);
  return {
    jump: async (ms = 260) => { await down(phone, '.action:has-text("JUMP")', 9); await phone.waitForTimeout(ms); await up(phone, '.action:has-text("JUMP")', 9); },
    act: () => phone.locator(".game-pad .action", { hasText: "ACTION" }).first().dispatchEvent("pointerdown", {}, { timeout: 1000 }).catch(() => undefined),
    release: async () => { await up(phone, ".arrow-right", 7); await up(phone, '.action:has-text("RUN")', 11); },
  };
}

/**
 * Plays until the podium: both phones hold ▶ + RUN and tap JUMP (different rhythms). Returns the fps samples. Calls
 * `each` with every state seen (screenshots, checks).
 */
export async function playToPodium(tv: Page, phones: Page[], ms: number, each?: (s: PlatDbg) => Promise<void>) {
  const s = platState(tv);
  const t = await Promise.all(phones.map((p) => thumbs(p)));
  const fps: number[] = [];
  let n = 0;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const st = await s();
    if (st.phase === "podium" || !st.phase) break;
    if (st.phase === "play") fps.push(st.fps);
    if (each) await each(st);
    await Promise.all(t.map((x, i) => x.jump(i === 0 ? 240 : n % 3 === 0 ? 140 : 320)));
    if (n % 3 === 1) await Promise.all(t.map((x) => x.act())); // throw / pull levers now and then
    n++;
    await tv.waitForTimeout(90);
  }
  await Promise.all(t.map((x) => x.release()));
  return fps;
}

export async function joinTwo(browser: Browser, code: string, modes: Record<string, "buttons" | "motion" | "touchpad"> = {}) {
  const a = await joinPhone(browser, code, "Asha", modes);
  const b = await joinPhone(browser, code, "Ravi", modes);
  return [a, b] as const;
}

/** Closes every page a test opened (TV and phones keep rendering otherwise and slow the next test down). */
export async function closeAll(browser: Browser) {
  for (const c of browser.contexts()) await c.close().catch(() => undefined);
}

/** Lite-tier TV budgets (the owner's 1 GB Mali-G31 TV). */
export function expectLiteBudgets(s: PlatDbg) {
  expect(s.tier).toBe("lite");
  expect(s.res).toBe("1280x720");
  expect(s.calls).toBeLessThanOrEqual(50);
  expect(s.tris).toBeLessThanOrEqual(30_000);
  expect(s.decodedMB).toBeLessThanOrEqual(60);
  expect(s.loadMs).toBeLessThan(10_000);
}

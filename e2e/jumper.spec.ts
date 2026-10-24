import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, padPoint, padTap, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

type P = { id: string; m: number; score: number; alive: boolean; x: number; tx: number | null; stored: string | null; powers: number; bounces: number; world: number };
type S = { phase?: string; time?: number; players?: P[] };

async function jumperTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => (): Promise<S> => tv.locator("[data-jumper]").getAttribute("data-jumper").then((s) => JSON.parse(s || "{}"));
/** Steering towards the next platform across the wrapping 400-unit column, in [-1, 1]. */
function steer(p: P) {
  if (p.tx === null) return 0;
  let d = (((p.tx - p.x) % 400) + 400) % 400;
  if (d > 200) d -= 400;
  return Math.max(-1, Math.min(1, d / 45));
}

test("Tilt Jumper Worlds with motion (the default): turn the phone to steer up the tower, flick up for the rocket", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await jumperTv(browser);
  const phone = await joinPhone(browser, code, "Asha");
  await tv.locator(".game-card", { hasText: "Tilt Jumper Worlds" }).click();
  await tv.getByRole("button", { name: /Start Tilt Jumper Worlds/ }).click();
  await expect(tv.locator(".tut-card[data-player=Asha]")).toHaveAttribute("data-mode", "motion", { timeout: 15_000 });
  await practiseUntilReady(tv, phone, "Asha", ["flick-up"]);
  const state = stateOf(tv);
  await expect.poll(async () => (await state()).phase, { timeout: 15_000 }).toBe("play");
  await expect(phone.locator('.game-pad[data-mode="motion"]')).toBeVisible();

  let shot = false, usedRocket = false, best = 0;
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const s = await state();
    const p = s.players?.[0];
    if (!p || s.phase === "over") break;
    best = Math.max(best, p.m);
    if (!usedRocket && (s.time ?? 0) > 2 && p.stored === "rocket") {
      usedRocket = true;
      await pose(phone, upright(0), 150);
      await gesture(phone, "flick-up");                         // fire the stored rocket
      await expect.poll(async () => (await state()).players?.[0]?.powers ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
      continue;
    }
    await pose(phone, upright(steer(p) * 24), 60);              // turn the phone like a wheel
    if (!shot && p.m > 60) {
      shot = true;
      await tv.screenshot({ path: "test-results/jumper-motion.png" });
      await phone.screenshot({ path: "test-results/jumper-pad-motion.png" });
    }
  }
  expect(usedRocket).toBe(true);
  expect(best).toBeGreaterThan(60);                             // a real climb (the rocket alone is ~230 m)
  await expect.poll(async () => (await state()).phase, { timeout: 40_000 }).toBe("over");
  await tv.screenshot({ path: "test-results/jumper-end.png" });
  await expect(phone.getByText(/m climbed|You climbed highest|#\d/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Tilt Jumper Worlds split screen: one phone on ◀ ▶ buttons, one on the touchpad, both climb to the finish", async ({ browser }) => {
  test.setTimeout(150_000);
  const { tv, code } = await jumperTv(browser);
  const btn = await joinPhone(browser, code, "Bala", { "Tilt Jumper Worlds": "buttons" });
  const pad = await joinPhone(browser, code, "Chitra", { "Tilt Jumper Worlds": "touchpad" });
  await tv.locator(".game-card", { hasText: "Tilt Jumper Worlds" }).click();
  await tv.getByRole("button", { name: /Start Tilt Jumper Worlds/ }).click();
  await practiseUntilReady(tv, btn, "Bala", ["btn:POWER"]);
  await practiseUntilReady(tv, pad, "Chitra", ["pad:tap"]);
  const state = stateOf(tv);
  await expect.poll(async () => (await state()).phase, { timeout: 15_000 }).toBe("play");
  await expect(tv.locator(".jumper-col")).toHaveCount(2);

  await press(btn, "POWER");                                     // both launch with their rocket
  await padTap(pad);
  await expect.poll(async () => (await state()).players?.map((p) => p.powers), { timeout: 5_000 }).toEqual([1, 1]);

  // Bala holds ◀ or ▶; Chitra keeps a finger on the pad, left or right of the middle
  let held: "left" | "right" | null = null;
  const arrows = async (dir: number) => {
    const want = dir > 0.25 ? "right" : dir < -0.25 ? "left" : null;
    if (want === held) return;
    if (held) await btn.locator(`.game-pad .arrow-${held}`).dispatchEvent("pointerup", { pointerId: 3 });
    if (want) await btn.locator(`.game-pad .arrow-${want}`).dispatchEvent("pointerdown", { pointerId: 3 });
    held = want;
  };
  const start = await padPoint(pad, 0, 0);
  await pad.mouse.move(start.x, start.y);
  await pad.mouse.down();
  let shot = false;
  const best = [0, 0];
  // each phone shows its result for only 3.5 s before the lobby returns, so watch for it from now on
  const results = Promise.all([btn, pad].map((p) => p.getByText(/You climbed highest|#\d/).waitFor({ timeout: 150_000 })));
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const s = await state();
    if (!s.players || s.phase === "over") break;
    const [a, b] = s.players;
    best[0] = Math.max(best[0]!, a!.m);
    best[1] = Math.max(best[1]!, b!.m);
    try {
      if (a!.alive) await arrows(steer(a!));
      if (b!.alive) {
        const p = await padPoint(pad, steer(b!) * 0.8, 0);
        await pad.mouse.move(p.x, p.y);
      }
    } catch {
      break; // the match ended between the check and the move: the phones now show the result
    }
    if (!shot && Math.min(best[0]!, best[1]!) > 120) {
      shot = true;
      await tv.screenshot({ path: "test-results/jumper-split.png" });
      await pad.screenshot({ path: "test-results/jumper-pad-touchpad.png" });
      await btn.screenshot({ path: "test-results/jumper-pad-buttons.png" });
    }
    await tv.waitForTimeout(40);
  }
  await results;
  await pad.mouse.up();
  await arrows(0).catch(() => undefined);
  console.log("jumper split best heights", best);
  expect(best[0]).toBeGreaterThan(60);
  expect(best[1]).toBeGreaterThan(60);
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

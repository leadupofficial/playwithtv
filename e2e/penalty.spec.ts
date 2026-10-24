import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, hold, joinPhone, pose, practiseUntilReady, press, swipe, tvCode, upright } from "./helpers";

async function penaltyTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => () => tv.locator("[data-penalty]").getAttribute("data-penalty").then((s) => JSON.parse(s || "{}"));
async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Global Penalty Cup" }).click();
  await tv.getByRole("button", { name: /Start Global Penalty Cup/ }).click();
}
/** Holds the joystick in a direction until `done()` says the crosshair is there. */
async function stickUntil(page: Page, x: number, y: number, done: () => Promise<boolean>) {
  const box = (await page.locator(".game-pad .stick").first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + x * r * 0.98, cy - y * r * 0.98, { steps: 3 });
  await expect.poll(done, { timeout: 5_000, intervals: [50] }).toBe(true);
  await page.mouse.up();
}
/** Waits for the next kick's aim phase and returns who kicks and who keeps (null once the match is over). */
async function nextAim(pen: () => Promise<Record<string, unknown>>, done: number) {
  await expect.poll(async () => {
    const s = await pen();
    if (!s.kicks) return "wait";
    const kicks = Object.values(s.kicks as Record<string, number>).reduce((a, b) => a + b, 0);
    return s.phase === "over" ? "over" : s.kick === "aim" && kicks === done ? "aim" : "wait";
  }, { timeout: 20_000, intervals: [100] }).not.toBe("wait");
  const s = await pen();
  return s.phase === "over" ? null : { kicker: s.kicker as string, keeper: s.keeper as string };
}

test("Global Penalty Cup with buttons (the default): two players kick and keep in turn; goals and saves, then the cup", async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await penaltyTv(browser);
  const arun = await joinPhone(browser, code, "Arun");
  const bala = await joinPhone(browser, code, "Bala");
  const phone = (name: string) => (name === "Arun" ? arun : bala);
  await start(tv);
  await practiseUntilReady(tv, arun, "Arun", ["btn:⚽ KICK"]);
  await practiseUntilReady(tv, bala, "Bala", ["btn:⚽ KICK"]);
  const pen = stateOf(tv);

  for (let n = 0; n < 4; n++) {
    const turn = await nextAim(pen, n);
    expect(turn).not.toBeNull();
    const { kicker, keeper } = turn!;
    expect(keeper).toBe(kicker === "Arun" ? "Bala" : "Arun"); // everyone kicks at the next player
    const k = phone(kicker), g = phone(keeper);
    await expect(k.locator(".game-pad .action", { hasText: "HOLD TO KICK" })).toBeVisible({ timeout: 5_000 });
    await expect(g.locator(".game-pad .action", { hasText: "DIVE ▶" })).toBeVisible({ timeout: 5_000 });
    if (n === 0) await g.screenshot({ path: "test-results/penalty-keeper-pad.png" });
    if (kicker === "Arun") {
      await stickUntil(k, -1, 0, async () => (await pen()).aim.x < -0.35); // crosshair to the left (TV state lags ~250 ms)
      if (n === 0) {
        const charging = hold(k, ".action", 800);              // power up…
        await tv.waitForTimeout(550);
        await tv.screenshot({ path: "test-results/penalty-aim.png" });
        await k.screenshot({ path: "test-results/penalty-kicker-pad.png" });
        await charging;                                        // …and let go
      } else await hold(k, ".action", 800);
      await expect.poll(async () => (await pen()).last, { timeout: 8_000 }).toBe("goal");
      if (n === 0) {
        await tv.waitForTimeout(150);
        await tv.screenshot({ path: "test-results/penalty-goal.png" });
      }
    } else {
      // Bala shoots straight down the middle; Arun guesses a jump the first time and stands tall the second
      if (n === 1) await press(g, "▲ JUMP");
      await hold(k, ".action", 700);
      await expect.poll(async () => (await pen()).last, { timeout: 8_000 }).toBe("save");
      if (n === 1) await tv.screenshot({ path: "test-results/penalty-save.png" });
    }
  }
  await expect.poll(async () => (await pen()).phase, { timeout: 15_000 }).toBe("over");
  const end = await pen();
  expect(end.goals).toEqual({ Arun: 2, Bala: 0 });
  expect(end.tally).toEqual({ goal: 2, save: 2, miss: 0 });
  expect(end.winners).toEqual(["Arun"]);
  await expect.poll(async () => (await pen()).cup, { timeout: 10_000 }).toBe(true);
  await tv.waitForTimeout(600);
  await tv.screenshot({ path: "test-results/penalty-final.png" });
  await expect(arun.getByText(/Champion! 2 goals/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Global Penalty Cup with motion, solo against the CPU: tilt to aim, push to shoot, flick to dive", async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await penaltyTv(browser);
  const devi = await joinPhone(browser, code, "Devi", { "Global Penalty Cup": "motion" });
  await start(tv);
  await practiseUntilReady(tv, devi, "Devi", ["push"]);
  const pen = stateOf(tv);
  let shots = 0;
  for (let n = 0; n < 12; n++) {
    const turn = await nextAim(pen, n);
    if (!turn) break;
    expect(turn.kicker === "Devi" || turn.keeper === "Devi").toBe(true);
    if (turn.kicker === "Devi") {
      await pose(devi, upright(-14, 8), 600);                  // turn left and tip forward: aim left, a bit high
      const aim = (await pen()).aim;
      expect(aim.x).toBeLessThan(-0.3);
      await gesture(devi, "push");
      await expect.poll(async () => (await pen()).kick, { timeout: 5_000 }).not.toBe("aim");
      shots++;
      await pose(devi, upright(0, 0), 200);
    } else {
      await gesture(devi, n % 4 === 1 ? "flick-left" : "flick-right"); // a keeper's guess
      await expect.poll(async () => { const s = await pen(); return s.guess ?? s.dive; }, { timeout: 5_000 }).not.toBeNull(); // a guess, or a dive if the CPU already shot
    }
  }
  expect(shots).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await pen()).phase, { timeout: 20_000 }).toBe("over");
  const end = await pen();
  expect(end.tally.goal + end.tally.save + end.tally.miss).toBe(Object.values(end.kicks as Record<string, number>).reduce((a, b) => a + b, 0));
  await expect(devi.getByText(/You won the shoot-out!|Robo Rovers won this time|shared cup/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Global Penalty Cup with the touchpad: a diagonal swipe aims to that side; swipes dive", async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await penaltyTv(browser);
  const esha = await joinPhone(browser, code, "Esha", { "Global Penalty Cup": "touchpad" });
  await start(tv);
  await expect(tv.locator('.tut-card[data-player="Esha"]')).toHaveAttribute("data-mode", "touchpad", { timeout: 15_000 });
  await expect(async () => {
    await swipe(esha, { x: 0, y: -0.7 }, { x: 0, y: 0.7 });
    await expect(tv.locator('.tut-card[data-player="Esha"]')).toHaveClass(/ready/, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  const pen = stateOf(tv);
  let dives = 0;
  for (let n = 0; n < 12; n++) {
    const turn = await nextAim(pen, n);
    if (!turn) break;
    await expect(esha.locator(".game-pad .touchpad")).toBeVisible({ timeout: 5_000 });
    if (turn.kicker === "Esha") {
      await expect(async () => {
        if ((await pen()).kick === "aim") await swipe(esha, { x: 0, y: -0.8 }, { x: 0.55, y: 0.2 }); // up and to the right
        await expect.poll(async () => (await pen()).kick, { timeout: 1_000 }).not.toBe("aim");
      }).toPass({ timeout: 6_000 });
      expect((await pen()).aim.x).toBeGreaterThan(0.25);
    } else {
      // dive left (a swipe the phone reads as too slow doesn't count, so swipe again while the ball is coming)
      for (let i = 0; i < 4; i++) {
        await swipe(esha, { x: 0.6, y: 0 }, { x: -0.6, y: 0 });
        const s = await pen();
        const d = s.guess ?? s.dive;
        if (d) {
          expect(d.dx).toBe(-1);
          dives++;
          break;
        }
        if (s.kick !== "aim" && s.kick !== "flight") break;
      }
    }
  }
  expect(dives).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await pen()).phase, { timeout: 20_000 }).toBe("over");
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

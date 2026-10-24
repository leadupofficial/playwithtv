import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, hold, holdAction, joinPhone, pose, practiseUntilReady, press, stroke, tvCode, upright } from "./helpers";

type Bowl = { names: Record<string, string>; phase: string; bowler: string; frame: number; ball: number; scores: Record<string, number>; rolls: Record<string, number[]>; pos: number; angle: number; spin: number; charging: boolean; thrown: boolean; ballY: number; standing: number; last: string };

async function bowlingTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => (): Promise<Bowl> => tv.locator("[data-bowling]").getAttribute("data-bowling").then((s) => JSON.parse(s || "{}"));
async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Bowling Master" }).click();
  await tv.getByRole("button", { name: /Start Bowling Master/ }).click();
}
/** Waits until it is this player's turn to aim (or the game is over). */
async function myTurn(state: () => Promise<Bowl>, id?: string) {
  await expect.poll(async () => { const s = await state(); return s.phase === "over" || (s.phase === "aim" && (!id || s.bowler === id)); }, { timeout: 30_000 }).toBe(true);
  return state();
}
const totalBalls = (s: Bowl) => Object.values(s.rolls ?? {}).reduce((n, r) => n + r.length, 0);

test("Bowling Master with motion (the default): turn to aim, push to roll, play a quick game to the end", async ({ browser }) => {
  test.setTimeout(240_000);
  const { tv, code } = await bowlingTv(browser);
  const phone = await joinPhone(browser, code, "Kavya");
  await start(tv);
  await practiseUntilReady(tv, phone, "Kavya", ["push"]);
  const state = stateOf(tv);
  let s = await myTurn(state);
  expect(s.frame).toBe(0);
  await tv.screenshot({ path: "test-results/bowling-aim.png" });

  // turning the phone swings the aim arrow
  await pose(phone, upright(20), 700);
  await expect.poll(async () => (await state()).angle, { timeout: 5_000 }).toBeGreaterThan(0.01);
  await pose(phone, upright(-20), 700);
  await expect.poll(async () => (await state()).angle, { timeout: 5_000 }).toBeLessThan(-0.01);
  await pose(phone, upright(0), 900);

  let shots = 0, pinShot = false;
  while (shots < 8) {
    s = await myTurn(state);
    if (s.phase === "over") break;
    const before = totalBalls(s);
    await gesture(phone, "push");
    await expect.poll(async () => (await state()).thrown, { timeout: 5_000 }).toBe(true);
    shots++;
    if (!pinShot) {
      await expect.poll(async () => (await state()).ballY, { timeout: 8_000 }).toBeGreaterThan(17.5);
      await tv.waitForTimeout(250);
      await tv.screenshot({ path: "test-results/bowling-pins.png" });
      pinShot = true;
    }
    await expect.poll(async () => totalBalls(await state()), { timeout: 20_000 }).toBe(before + 1);
    if (shots === 1) await tv.screenshot({ path: "test-results/bowling-result.png" });
  }
  s = await state();
  expect(s.phase).toBe("over");
  const rolls = Object.values(s.rolls)[0]!;
  expect(rolls.length).toBeGreaterThanOrEqual(2);                 // two frames: 2 to 4 balls
  expect(Object.values(s.scores)[0]).toBeGreaterThanOrEqual(rolls.reduce((a, b) => a + b, 0)); // pins plus any bonus
  expect(rolls.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);   // a straight push down the middle knocks pins down
  await tv.screenshot({ path: "test-results/bowling-over.png" });
  await expect(phone.getByText(/You scored \d+!/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Bowling Master with buttons and touchpad: two players, power meter and swipe, to the final scores", async ({ browser }) => {
  test.setTimeout(300_000);
  const { tv, code } = await bowlingTv(browser);
  const a = await joinPhone(browser, code, "Babu", { "Bowling Master": "buttons" });
  const b = await joinPhone(browser, code, "Tara", { "Bowling Master": "touchpad" });
  await start(tv);
  // buttons: ROLL is held (it charges the meter), so practising it is a press and release
  const cardA = tv.locator('.tut-card[data-player="Babu"]');
  await expect(cardA).toContainText("✓", { timeout: 15_000 });
  await holdAction(a, "ROLL", 300);
  await expect(cardA).toHaveClass(/ready/, { timeout: 10_000 });
  const cardB = tv.locator('.tut-card[data-player="Tara"]');
  await expect(cardB).toContainText("✓", { timeout: 15_000 });
  for (let k = 0; k < 5 && !/ready/.test((await cardB.getAttribute("class")) ?? ""); k++) {
    await stroke(b, [0, -0.7], [0, 0.7], 60);                    // swipe up (again if the busy machine made it too slow)
    await b.waitForTimeout(300);
  }
  await expect(cardB).toHaveClass(/ready/, { timeout: 10_000 });

  const state = stateOf(tv);
  let s = await myTurn(state);
  const ids = Object.keys(s.rolls);
  expect(ids).toHaveLength(2);
  const idOf = (name: string) => Object.keys(s.names).find((id) => s.names[id] === name)!;
  const idA = idOf("Babu"), idB = idOf("Tara");
  await expect(a.locator('.game-pad[data-mode="buttons"] .action')).toHaveCount(2);   // ROLL and SPIN
  await expect(b.locator('.game-pad[data-mode="touchpad"] .touchpad')).toBeVisible();

  let shot = false, spun = false;
  for (let i = 0; i < 16; i++) {
    s = await state();
    if (s.phase === "over") break;
    s = await myTurn(state);
    if (s.phase === "over") break;
    const before = totalBalls(s);
    if (s.bowler === idA) {
      const pos0 = s.pos;
      await hold(a, ".arrow-right", 250);                         // ◀ ▶ walk
      await expect.poll(async () => (await state()).pos).toBeGreaterThan(pos0);
      if (!spun) {
        spun = true;
        await press(a, "SPIN");
        await expect.poll(async () => (await state()).spin).toBe(-1);
      }
      // hold ROLL: the meter swings; let go near the top
      const roll = a.locator(".game-pad .action", { hasText: "ROLL" }).first();
      await roll.dispatchEvent("pointerdown", { pointerId: 9 });
      await expect.poll(async () => (await state()).charging, { timeout: 3_000 }).toBe(true);
      await a.waitForTimeout(650);
      if (!shot) { await tv.screenshot({ path: "test-results/bowling-power.png" }); await a.screenshot({ path: "test-results/bowling-pad-buttons.png" }); shot = true; }
      await roll.dispatchEvent("pointerup", { pointerId: 9 });
    } else {
      expect(s.bowler).toBe(idB);
      await stroke(b, [0, -0.2], [-0.3, -0.2], 400);              // a slow drag walks left
      await expect.poll(async () => (await state()).pos).toBeLessThan(0);
      // swipe up, slanted right (a busy test machine can make a swipe too slow to count: try again, like a player)
      for (let k = 0; k < 4 && !(await state()).thrown; k++) {
        await stroke(b, [0, -0.8], [0.12, 0.7], 60);
        await b.waitForTimeout(400);
      }
    }
    await expect.poll(async () => (await state()).thrown, { timeout: 5_000 }).toBe(true);
    await expect.poll(async () => totalBalls(await state()), { timeout: 20_000 }).toBe(before + 1);
  }
  s = await state();
  expect(s.phase).toBe("over");
  expect(s.rolls[idA]!.length).toBeGreaterThanOrEqual(2);
  expect(s.rolls[idB]!.length).toBeGreaterThanOrEqual(2);
  await tv.screenshot({ path: "test-results/bowling-two-players.png" });
  await expect(a.getByText(/You won with \d+!|You came #2/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

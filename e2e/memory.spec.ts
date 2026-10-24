import { expect, test, type Browser, type Page } from "@playwright/test";
import { gesture, joinPhone, practiseUntilReady, press, swipe, tvCode } from "./helpers";

type Dir = "up" | "right" | "down" | "left";
const LABEL: Record<Dir, string> = { up: "▲ UP", right: "● RIGHT", down: "■ DOWN", left: "◆ LEFT" };
const OTHER: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const SWIPE: Record<Dir, [{ x: number; y: number }, { x: number; y: number }]> = {
  up: [{ x: 0, y: -0.6 }, { x: 0, y: 0.6 }], down: [{ x: 0, y: 0.6 }, { x: 0, y: -0.6 }],
  left: [{ x: 0.6, y: 0 }, { x: -0.6, y: 0 }], right: [{ x: -0.6, y: 0 }, { x: 0.6, y: 0 }],
};

async function memoryTv(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const stateOf = (tv: Page) => () => tv.locator("[data-memory]").getAttribute("data-memory").then((s) => JSON.parse(s || "{}"));
async function start(tv: Page) {
  await tv.locator(".game-card", { hasText: "Memory Wave" }).click();
  await tv.getByRole("button", { name: /Start Memory Wave/ }).click();
}

test("Memory Wave: buttons player repeats every wave, a motion player slips three times and is out; last one standing wins", async ({ browser }) => {
  test.setTimeout(180_000);
  const { tv, code } = await memoryTv(browser);
  const ana = await joinPhone(browser, code, "Ana");                                  // buttons: the default
  const ben = await joinPhone(browser, code, "Ben", { "Memory Wave": "motion" });
  await start(tv);
  await practiseUntilReady(tv, ana, "Ana", ["btn:▲ UP"]);
  await practiseUntilReady(tv, ben, "Ben", ["flick-up"]);
  await expect(ana.locator('.game-pad[data-mode="buttons"] .action')).toHaveCount(4);
  const mem = stateOf(tv);

  for (let round = 0; round < 3; round++) {
    if (round === 0) {
      await expect.poll(async () => (await mem()).lit, { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
      await tv.screenshot({ path: "test-results/memory-show.png" });
    }
    await expect.poll(async () => { const s = await mem(); return s.phase === "input" && s.round === round; }, { timeout: 20_000 }).toBe(true);
    const seq = (await mem()).seq as Dir[];
    expect(seq).toHaveLength(2 + round);
    // Ben flicks the first step right, then the wrong way
    await gesture(ben, `flick-${seq[0]!}`);
    await expect.poll(async () => (await mem()).players.Ben.progress, { timeout: 5_000 }).toBe(1);
    for (const d of seq) await press(ana, LABEL[d]);
    await expect.poll(async () => (await mem()).players.Ana.status, { timeout: 5_000 }).toBe("done");
    if (round === 1) await tv.screenshot({ path: "test-results/memory-input.png" });
    if (round === 0) await ana.screenshot({ path: "test-results/memory-pad.png" });
    await gesture(ben, `flick-${OTHER[seq[1]!]}`);
    await expect.poll(async () => (await mem()).players.Ben.lives, { timeout: 5_000 }).toBe(2 - round);
  }
  const end = await mem();
  expect(end.players.Ben.out).toBe(true);
  expect(end.players.Ana).toMatchObject({ lives: 3, out: false });
  await expect.poll(async () => (await mem()).phase, { timeout: 10_000 }).toBe("over");
  expect((await mem()).winners).toEqual(["Ana"]);
  await tv.screenshot({ path: "test-results/memory-final.png" });
  await expect(ana.getByText("You won Memory Wave!")).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Memory Wave with the touchpad: swipe every wave right, solo, to the end", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await memoryTv(browser);
  const cara = await joinPhone(browser, code, "Cara", { "Memory Wave": "touchpad" });
  await start(tv);
  await expect(tv.locator('.tut-card[data-player="Cara"]')).toHaveAttribute("data-mode", "touchpad", { timeout: 15_000 });
  await expect(cara.locator(".game-pad .touchpad")).toBeVisible();
  await swipe(cara, ...SWIPE.up);
  await expect(tv.locator('.tut-card[data-player="Cara"]')).toHaveClass(/ready/, { timeout: 10_000 });
  const mem = stateOf(tv);
  for (let round = 0; round < 3; round++) {
    await expect.poll(async () => { const s = await mem(); return s.phase === "input" && s.round === round; }, { timeout: 20_000 }).toBe(true);
    const seq = (await mem()).seq as Dir[];
    for (const d of seq) await swipe(cara, ...SWIPE[d]);
    await expect.poll(async () => (await mem()).players.Cara.status, { timeout: 5_000 }).toBe("done");
    if (round === 0) await cara.screenshot({ path: "test-results/memory-touchpad.png" });
  }
  await expect.poll(async () => (await mem()).phase, { timeout: 10_000 }).toBe("over");
  expect((await mem()).players.Cara.points).toBe(3 * 50 + (2 + 3 + 4) * 10);
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

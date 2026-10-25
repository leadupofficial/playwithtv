import { expect, test } from "@playwright/test";
import { hold, joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

/** Kings Row: two phones play draughts against each other, take turns, and one resigns. */
test("Kings Row: two phones take turns moving pieces, then one resigns", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const ana = await joinPhone(browser, code, "Ana", { "Kings Row": "buttons" });
  const ben = await joinPhone(browser, code, "Ben", { "Kings Row": "buttons" });

  await tv.locator(".shelf", { hasText: "Two-player" }).click();
  await tv.locator(".game-card", { hasText: "Kings Row" }).click();
  await tv.getByRole("button", { name: /Start Kings Row/ }).click();
  await practiseUntilReady(tv, ana, "Ana", ["btn:✋ Pick"] as never);
  await practiseUntilReady(tv, ben, "Ben", ["btn:✋ Pick"] as never);

  const g = async () => JSON.parse((await tv.locator("[data-grid]").getAttribute("data-grid")) || "{}");
  await expect.poll(async () => (await g()).phase, { timeout: 15_000 }).toBe("map");
  expect((await g()).team).toEqual(["Ana", "Ben"]);
  await expect(tv.locator(".grid-pilot")).toHaveText(/Ana vs Ben/);
  await press(ana, /Play/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("story");
  await press(ana, /Start/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("play");
  await expect(ana.getByRole("button", { name: /Prev/ })).toHaveCount(0);

  const tap = async (p: typeof ana, arrow: string) => { await hold(p, `.arrow-${arrow}`, 90); await p.waitForTimeout(80); };
  /** Steps a cursor to a square (re-reading where it is, so a missed tap is just retried). */
  const goTo = async (p: typeof ana, who: number, sq: number) => {
    for (let i = 0; i < 16; i++) {
      const at = (await g()).cursors[who] as number;
      if (at === sq) return;
      await tap(p, (at >> 3) > (sq >> 3) ? "up" : (at >> 3) < (sq >> 3) ? "down" : (at & 7) < (sq & 7) ? "right" : "left");
    }
    expect((await g()).cursors[who]).toBe(sq);
  };
  // Ana (red, bottom) moves the corner man up one: a6 → b5. Her cursor starts on it.
  expect((await g()).cursors[0]).toBe(40);
  await press(ben, /Pick/); // not Ben's turn: nothing happens
  expect((await g()).turn).toBe(0);
  await press(ana, /Pick/);
  await expect.poll(async () => (await g()).sel, { timeout: 2_000 }).toEqual([40]);
  await goTo(ana, 0, 33);
  await press(ana, /Pick/);
  await expect.poll(async () => (await g()).turn, { timeout: 2_000 }).toBe(1);
  expect((await g()).board[4]).toBe(".o......");

  // Ben (dark, top): b3 → a4
  expect((await g()).cursors[1]).toBe(17);
  await press(ben, /Pick/);
  await goTo(ben, 1, 24);
  await press(ben, /Pick/);
  await expect.poll(async () => (await g()).turn, { timeout: 2_000 }).toBe(0);
  expect((await g()).board[3]).toBe("x.......");
  expect((await g()).plies).toBe(2);
  await tv.screenshot({ path: "test-results/kings-play.png" });

  // Ana gives up: ↩ twice
  await press(ana, /Back/);
  await press(ana, /Back/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("result");
  await expect(tv.locator(".grid-result h2")).toHaveText("Ben wins!");
  expect(errors).toEqual([]);
});

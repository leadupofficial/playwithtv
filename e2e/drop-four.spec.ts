import { expect, test } from "@playwright/test";
import { hold, joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

/** Drop Four: two phones take turns dropping discs; Ana lines up four along the bottom. */
test("Drop Four: two phones take turns and four in a row wins", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const ana = await joinPhone(browser, code, "Ana", { "Drop Four": "buttons" });
  const ben = await joinPhone(browser, code, "Ben", { "Drop Four": "buttons" });

  await tv.locator(".shelf", { hasText: "Two-player" }).click();
  await tv.locator(".game-card", { hasText: "Drop Four" }).click();
  await tv.getByRole("button", { name: /Start Drop Four/ }).click();
  await practiseUntilReady(tv, ana, "Ana", ["btn:✋ Drop"] as never);
  await practiseUntilReady(tv, ben, "Ben", ["btn:✋ Drop"] as never);

  const g = async () => JSON.parse((await tv.locator("[data-grid]").getAttribute("data-grid")) || "{}");
  await expect.poll(async () => (await g()).phase, { timeout: 15_000 }).toBe("map");
  await expect(tv.locator(".grid-pilot")).toHaveText(/Ana vs Ben/);
  await expect(tv.locator(".grid-level")).toHaveText(/Match 1 · Fair booth 1/);
  await press(ana, /Play/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("story");
  await press(ana, /Start/);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("play");

  const nudge = async (p: typeof ana, arrow: string) => { await hold(p, `.arrow-${arrow}`, 90); await p.waitForTimeout(80); };
  const dropAt = async (p: typeof ana, who: number, col: number) => {
    for (let i = 0; i < 8 && (await g()).cols[who] !== col; i++) await nudge(p, (await g()).cols[who] < col ? "right" : "left");
    expect((await g()).cols[who]).toBe(col);
    await press(p, /Drop/);
    await expect.poll(async () => (await g()).turn !== who || !!(await g()).outcome, { timeout: 3_000 }).toBe(true);
    await expect.poll(async () => (await g()).falling, { timeout: 3_000 }).toBe(false);
  };
  await press(ben, /Drop/); // not Ben's turn
  expect((await g()).drops).toEqual([0, 0]);
  await dropAt(ana, 0, 0);
  await dropAt(ben, 1, 0);
  await dropAt(ana, 0, 1);
  await dropAt(ben, 1, 1);
  await dropAt(ana, 0, 2);
  await dropAt(ben, 1, 6);
  expect((await g()).rows[5]).toBe("ooo...x");
  await tv.screenshot({ path: "test-results/four-play.png" });
  await dropAt(ana, 0, 3);
  await expect.poll(async () => (await g()).phase, { timeout: 5_000 }).toBe("result");
  await expect(tv.locator(".grid-result h2")).toHaveText("Ana wins!");
  expect(errors).toEqual([]);
});

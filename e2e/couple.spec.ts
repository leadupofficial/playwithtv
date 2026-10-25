import { expect, test, type Browser, type Page } from "@playwright/test";
import { joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

/**
 * The couples games (kitcouple): two phones play a quick (?quick=1, 2-card) chapter on a real TV page. Covers the
 * Couples shelf, secret picks (the TV shows locks, not answers, until both are in), stars and saved progress,
 * and the 18+ After Dark gate (needs BOTH players; either can decline, and declining keeps it closed).
 */

async function tvPage(browser: Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const errors: string[] = [];
  tv.on("pageerror", (e) => errors.push(String(e)));
  tv.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_CONNECTION|WebSocket/.test(m.text())) errors.push(m.text()); });
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv), errors };
}
const state = (tv: Page) => () => tv.locator("[data-couple]").getAttribute("data-couple").then((s) => JSON.parse(s || "{}"));
const shot = (tv: Page, name: string) => tv.screenshot({ path: `test-results/couple-${name}.png` });

async function start(browser: Browser, title: string) {
  const { tv, code, errors } = await tvPage(browser);
  const ana = await joinPhone(browser, code, "Ana");
  const ben = await joinPhone(browser, code, "Ben");
  await tv.locator(".shelf", { hasText: "Couples" }).click();
  await expect(tv.locator(".game-card", { hasText: title })).toBeVisible();
  await expect(tv.locator(".game-card", { hasText: "Glowworm Grove" })).toHaveCount(0);
  await tv.locator(".game-card", { hasText: title }).click();
  await tv.getByRole("button", { name: new RegExp(`Start ${title}`) }).click();
  await practiseUntilReady(tv, ana, "Ana", []);
  await practiseUntilReady(tv, ben, "Ben", []);
  const s = state(tv);
  await expect.poll(async () => (await s()).phase, { timeout: 15_000 }).toBe("chapters");
  return { tv, ana, ben, s, errors };
}

test("Two Paths: secret picks, reveal, stars saved, next chapter opens", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, ana, ben, s, errors } = await start(browser, "Two Paths");
  await shot(tv, "chapters");
  await press(ana, "▶ Play");
  await expect.poll(async () => (await s()).phase).toBe("story");
  await press(ben, "▶ Start");
  await expect.poll(async () => (await s()).phase).toBe("play");

  for (let round = 0; round < 2; round++) {
    await expect.poll(async () => (await s()).step).toBe("ask");
    await press(ana, "🅰");
    // Ana is locked in: her buttons are gone, and the TV shows a lock, not her answer
    await expect(ana.locator(".game-pad .action", { hasText: "🅰" })).toHaveCount(0);
    await expect(tv.locator(".couple-option .who span")).toHaveCount(0);
    await expect(tv.locator(".couple-locks .in")).toHaveCount(1);
    if (round === 0) await shot(tv, "locked");
    await press(ben, "🅰");
    await expect.poll(async () => (await s()).step).toBe("reveal");
    await expect(tv.locator(".couple-option.c0 .who span")).toHaveCount(2);
    if (round === 0) await shot(tv, "reveal");
    await press(ben, "▶ Next");
  }
  await expect.poll(async () => (await s()).phase, { timeout: 5_000 }).toBe("result");
  expect((await s()).result.stars).toBe(3);
  await shot(tv, "result");
  const saved = await tv.evaluate(() => JSON.parse(localStorage.getItem("pwtv.grid.two-paths") ?? "{}"));
  expect(saved.stars?.[0]).toBe(3);

  await press(ana, "▶ Next"); // straight on to chapter 2 (Road Trip)
  await expect.poll(async () => (await s()).phase).toBe("story");
  expect((await s()).chapter).toBe(1);
  expect(errors).toEqual([]);
});

test("Lantern Truths: After Dark needs both players to confirm 18+, declining keeps it closed, passing is free", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, ana, ben, s, errors } = await start(browser, "Lantern Truths");
  await press(ana, "◀ Chapter"); // wraps round to After Dark
  await expect.poll(async () => (await s()).chapter).toBe(4);
  await shot(tv, "after-dark-listed");

  // Ana confirms, Ben declines: back to the chapters, nothing opened
  await press(ana, "▶ Play");
  await expect.poll(async () => (await s()).phase).toBe("gate");
  await press(ana, "✅ I'm 18+");
  await expect.poll(async () => (await s()).gate).toEqual([true, false]);
  await shot(tv, "gate");
  await press(ben, "✖ Not for us");
  await expect.poll(async () => (await s()).phase).toBe("chapters");

  // both confirm: After Dark opens
  await press(ben, "▶ Play");
  await expect.poll(async () => (await s()).phase).toBe("gate");
  expect((await s()).gate).toEqual([false, false]); // a fresh check every time it's asked
  await press(ana, "✅ I'm 18+");
  await press(ben, "✅ I'm 18+");
  await expect.poll(async () => (await s()).phase).toBe("story");
  await press(ana, "▶ Start");
  await expect.poll(async () => (await s()).phase).toBe("play");

  for (let round = 0; round < 2; round++) {
    await expect.poll(async () => (await s()).step).toBe("ask");
    // whoever's turn it is sees Truth / Dare; the other phone has no buttons
    const anaTurn = (await ana.locator(".game-pad .action", { hasText: "Truth" }).count()) > 0;
    const [me, partner] = anaTurn ? [ana, ben] : [ben, ana];
    await expect(partner.locator(".game-pad .action", { hasText: "Truth" })).toHaveCount(0);
    await press(me, round === 0 ? "💬 Truth" : "🔥 Dare");
    await expect.poll(async () => (await s()).step).toBe("card");
    if (round === 0) await shot(tv, "spicy-card");
    // the partner can pass it: no penalty, no questions
    await press(partner, round === 0 ? "✅ Done!" : "🙅 Pass");
    await expect.poll(async () => (await s()).step).toBe("reveal");
    await press(me, "▶ Next");
  }
  await expect.poll(async () => (await s()).phase, { timeout: 5_000 }).toBe("result");
  // After Dark is a bonus: it never counts towards progress or rewards
  const saved = await tv.evaluate(() => JSON.parse(localStorage.getItem("pwtv.grid.lantern-truths") ?? "{}"));
  expect(saved.stars?.[4] ?? 0).toBe(0);
  await press(ana, "◀ Chapters");
  await expect.poll(async () => (await s()).phase).toBe("chapters");
  expect(errors).toEqual([]);
});

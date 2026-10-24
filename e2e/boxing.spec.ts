import { expect, test } from "@playwright/test";
import { gesture, hold, joinPhone, pose, practiseUntilReady, press, tvCode, upright } from "./helpers";

async function boxingTv(browser: import("@playwright/test").Browser) {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  return { tv, code: await tvCode(tv) };
}
const fightOf = (tv: import("@playwright/test").Page) => () => tv.locator("[data-fight]").getAttribute("data-fight").then((s) => JSON.parse(s || "{}"));

test("Ring Kings Boxing with buttons (the default): walk in with ▶, punch with JAB/HOOK, fight the CPU to a finish", async ({ browser }) => {
  test.setTimeout(300_000);
  const { tv, code } = await boxingTv(browser);
  const phone = await joinPhone(browser, code, "Arun");
  await tv.locator(".game-card", { hasText: "Ring Kings Boxing" }).click();
  await tv.getByRole("button", { name: /Start Ring Kings Boxing/ }).click();
  await practiseUntilReady(tv, phone, "Arun", ["btn:JAB"]);
  const fight = fightOf(tv);
  await expect.poll(async () => (await fight()).phase, { timeout: 15_000 }).toBe("fight");
  await expect(phone.locator('.game-pad[data-mode="buttons"] .action')).toHaveCount(7);

  let shot = false;
  const until = Date.now() + 200_000;
  for (let i = 0; Date.now() < until; i++) {
    const s = await fight();
    if (s.phase === "over") break;
    if (!(await phone.locator(".game-pad .action").first().isVisible())) break; // the phone now shows the result
    try {
      if (s.xB - s.xA > 200) await hold(phone, ".arrow-right", 300); // close the distance
      await press(phone, i % 3 === 0 ? "HOOK" : "JAB");
      if (i % 5 === 4) await press(phone, "GET UP");                // harmless when standing, needed when down
    } catch {
      break; // the fight ended between the check and the press: the phone switched to the result
    }
    if (!shot && s.landedA >= 3) {
      shot = true;
      await tv.screenshot({ path: "test-results/boxing-buttons.png" });
      await phone.screenshot({ path: "test-results/boxing-pad.png" });
      expect(s.hpB).toBeLessThan(100);
    }
  }
  expect(shot).toBe(true);
  await expect.poll(async () => (await fight()).phase, { timeout: 60_000 }).toBe("over");
  await expect(phone.getByText(/You won the fight!|You lost this one|draw/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

test("Ring Kings Boxing with motion: tip forward to step in, push to jab, and the punches land", async ({ browser }) => {
  test.setTimeout(120_000);
  const { tv, code } = await boxingTv(browser);
  const phone = await joinPhone(browser, code, "Meena", { "Ring Kings Boxing": "motion" });
  await tv.locator(".game-card", { hasText: "Ring Kings Boxing" }).click();
  await tv.getByRole("button", { name: /Start Ring Kings Boxing/ }).click();
  await practiseUntilReady(tv, phone, "Meena", ["push"]);
  const fight = fightOf(tv);
  await expect.poll(async () => (await fight()).phase, { timeout: 15_000 }).toBe("fight");
  for (let i = 0; i < 25 && (await fight()).landedA < 2; i++) {
    await pose(phone, upright(0, 22), 350);
    await pose(phone, upright(0, 0), 100);
    await gesture(phone, "push");
  }
  expect((await fight()).landedA).toBeGreaterThanOrEqual(2);
  expect((await fight()).hpB).toBeLessThan(100);
});

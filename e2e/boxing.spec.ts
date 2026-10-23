import { expect, test } from "@playwright/test";
import { gesture, joinPhone, pose, practiseUntilReady, tvCode, upright } from "./helpers";

test("Ring Kings Boxing by motion: tip forward to step in, push to jab, fight the CPU to a finish", async ({ browser }) => {
  test.setTimeout(300_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const phone = await joinPhone(browser, code, "Arun");
  await tv.locator(".game-card", { hasText: "Ring Kings Boxing" }).click();
  await tv.getByRole("button", { name: /Start Ring Kings Boxing/ }).click();
  await practiseUntilReady(tv, phone, "Arun", ["push", "flick-up"]);

  const fight = () => tv.locator("[data-fight]").getAttribute("data-fight").then((s) => JSON.parse(s || "{}"));
  await expect.poll(async () => (await fight()).phase, { timeout: 15_000 }).toBe("fight");
  await expect(phone.locator(".mp-watch")).toBeVisible(); // no buttons on the phone, just "watch the TV"
  await expect(phone.locator("button.pad")).toHaveCount(0);

  let shot = false;
  const until = Date.now() + 200_000;
  while (Date.now() < until) {
    const s = await fight();
    if (s.phase === "over") break;
    await pose(phone, upright(0, 22), 350);        // tip forward: walk in
    await pose(phone, upright(0, 0), 100);
    await gesture(phone, "push");                  // jab
    await gesture(phone, "push", 26);              // strong push: power punch
    if (!shot && s.landedA >= 3) {
      shot = true;
      await tv.screenshot({ path: "test-results/boxing-motion.png" });
      expect(s.hpB).toBeLessThan(100);             // motion punches really land on the CPU
    }
  }
  expect(shot).toBe(true);
  await expect.poll(async () => (await fight()).phase, { timeout: 60_000 }).toBe("over");
  await expect(phone.getByText(/You won the fight!|You lost this one|draw/)).toBeVisible({ timeout: 10_000 });
  await expect(tv.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 15_000 });
});

import { expect, test } from "@playwright/test";
import { newPhonePage, press, startController, tvCode } from "./helpers";

async function join(browser: import("@playwright/test").Browser, code: string, name: string, query = "") {
  const page = await newPhonePage(browser); // with the synthetic motion sensor
  await page.goto(`/join${query}`);
  await page.getByLabel("TV code").fill(code);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join as guest" }).click();
  await startController(page);
  return page;
}

test("a phone on the same network links directly to the TV; with direct links off it still plays via the server", async ({ browser }) => {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);

  const near = await join(browser, code, "Near");
  await expect(tv.locator('.player[data-link="direct"]', { hasText: "Near" })).toBeVisible({ timeout: 15_000 });
  await expect(near.locator('[data-link="direct"]')).toContainText("Direct", { timeout: 5_000 });

  const far = await join(browser, code, "Far", "?p2p=0");
  await expect(tv.locator(".player", { hasText: "Far" })).toBeVisible();
  await tv.waitForTimeout(3000);
  await expect(tv.locator('.player[data-link="server"]', { hasText: "Far" })).toBeVisible();
  // the phone without a direct link is nudged onto the TV's Wi-Fi (after 8 s); the linked phone never is
  await expect(far.locator('[data-wifi="slow"]')).toBeVisible({ timeout: 15_000 });
  await expect(near.locator('[data-wifi="slow"]')).toHaveCount(0);
  await expect(tv.locator('.player[data-link="server"]', { hasText: "Far" })).toContainText("same Wi-Fi");

  // both paths deliver motion into a game: the practice gesture ticks for each player
  await tv.locator(".game-card", { hasText: "Sky Gyro Racer" }).click();
  await tv.getByRole("button", { name: /Start Sky Gyro Racer/ }).click();
  for (const [phone, name] of [[near, "Near"], [far, "Far"]] as const) {
    const card = tv.locator(`.tut-card[data-player="${name}"]`);
    await expect(card).toContainText("✓", { timeout: 10_000 });
    await press(phone, "BOOST");                      // hybrid pad's button
    await expect(card).toHaveClass(/ready/, { timeout: 10_000 });
  }
});

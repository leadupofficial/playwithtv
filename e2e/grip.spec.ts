import { expect, test } from "@playwright/test";
import { joinPhone, tvCode } from "./helpers";

/**
 * One-handed motion games (a saber hilt, a bat) are played with the phone upright: no rotate prompt over the
 * controller. Their buttons mode, and two-handed games, still ask for landscape.
 */
test("held upright: Beat Blade in motion mode plays on, its buttons mode asks to rotate", async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const phone = await joinPhone(browser, code, "Dev", { "Beat Blade": "motion" }, { iphone: true });
  const rotate = phone.locator(".rotate-hint");

  await tv.locator(".game-card", { hasText: "Beat Blade" }).click();
  await tv.getByRole("button", { name: /Start Beat Blade/ }).click();
  await expect(phone.locator(".mode-chip")).toBeVisible({ timeout: 15_000 }); // the game controller is up
  // the player turns the phone upright, like a hilt (an iPhone has no landscape lock to stop them)
  await phone.evaluate(() => document.fullscreenElement && document.exitFullscreen()); // the test browser cannot resize a full-screen window
  await phone.setViewportSize({ width: 393, height: 852 });
  await expect(phone.locator(".controller")).toHaveAttribute("data-grip", "any");
  await expect(rotate).toBeHidden();
  await phone.screenshot({ path: "test-results/grip-beat-upright.png" });

  // buttons need two thumbs: landscape again
  await phone.getByRole("button", { name: "Change controls" }).click();
  await expect(phone.locator(".controller")).not.toHaveAttribute("data-grip", "any");
  await expect(rotate).toBeVisible();
});

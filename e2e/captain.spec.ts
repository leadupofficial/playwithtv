import { expect, test } from "@playwright/test";
import { joinPhone, practiseUntilReady, press, tvCode } from "./helpers";

test("the captain's phone picks a game, presses Play, ends it, and plays again: no TV remote needed", async ({ browser }) => {
  test.setTimeout(180_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const cap = await joinPhone(browser, code, "Captain");
  const guest = await joinPhone(browser, code, "Guest");

  await expect(cap.locator("[data-captain]")).toContainText("You're the captain");
  await expect(guest.getByText(/Captain picks the game/)).toBeVisible();
  await expect(guest.locator("[data-captain]")).toHaveCount(0);

  // pick and play from the phone
  await cap.locator(".menu-game", { hasText: "Tamil Trivia Royale" }).click();
  await expect(tv.locator(".game-card.selected", { hasText: "Tamil Trivia Royale" })).toBeVisible();
  await cap.getByRole("button", { name: /Play Tamil Trivia Royale/ }).click();
  await expect(tv.locator("[data-tutorial]")).toBeVisible({ timeout: 10_000 });

  // end it early from the captain's phone (everyone back to the lobby)
  await cap.getByRole("button", { name: "End the game" }).click();
  await cap.getByRole("button", { name: "End game" }).click();
  await expect(tv.getByText("Choose a game")).toBeVisible({ timeout: 10_000 });
  await expect(cap.locator("[data-captain]")).toBeVisible();
  await expect(guest.getByRole("button", { name: "End the game" })).toHaveCount(0); // only the captain has it

  // play a full quick game and use Rematch from the phone
  await cap.locator(".menu-game", { hasText: "Tamil Trivia Royale" }).click();
  await cap.getByRole("button", { name: /Play Tamil Trivia Royale/ }).click();
  await practiseUntilReady(tv, cap, "Captain", []);
  await practiseUntilReady(tv, guest, "Guest", []);
  for (let q = 1; q <= 3; q++) {
    await expect(tv.getByText(new RegExp(`Question ${q} / `))).toBeVisible({ timeout: 20_000 });
    await expect(tv.locator(".q-ta")).toBeVisible({ timeout: 20_000 });
    await press(cap, "▲");
    await press(guest, "◆");
  }
  await expect(cap.getByRole("button", { name: /Rematch/ })).toBeVisible({ timeout: 20_000 });
  await cap.getByRole("button", { name: /Choose another game/ }).click();
  await expect(cap.locator(".menu-game").first()).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { joinPhone, tvCode } from "./helpers";

test("the TV host removes an unexpected player; the phone is told, and the join code changes", async ({ browser }) => {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv");
  const code = await tvCode(tv);
  const stranger = await joinPhone(browser, code, "Stranger");
  await expect(tv.locator(".player", { hasText: "Stranger" })).toBeVisible();

  await tv.getByRole("button", { name: "Remove Stranger" }).click();
  await expect(tv.getByRole("dialog")).toContainText("Remove Stranger?");
  await tv.getByRole("dialog").getByRole("button", { name: "Remove" }).click();

  await expect(tv.locator(".player", { hasText: "Stranger" })).toHaveCount(0);
  await expect(stranger.getByText("The TV host removed you from this game.")).toBeVisible();
  await expect.poll(() => tvCode(tv)).not.toBe(code); // a fresh code: the old one can't be reused
});

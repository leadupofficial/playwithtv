import { expect, test, type Page } from "@playwright/test";
import { gesture, newPhonePage, pose, practiseUntilReady, startController, tvCode, upright } from "./helpers";

async function tvInvite(tv: Page) {
  return tv.evaluate(() => JSON.parse(sessionStorage.getItem("pwtv.tv.room") ?? "{}")) as Promise<{ joinCode: string; inviteToken: string }>;
}

/** Each phone turns to its answer (Priya far left, Karthik far right) and pushes towards the TV to lock it. */
async function answer(tv: Page, phones: Array<[Page, string, number]>, n: number) {
  await expect(tv.getByText(new RegExp(`Question ${n} / `))).toBeVisible({ timeout: 20_000 });
  await expect(tv.locator(".q-ta")).toBeVisible({ timeout: 20_000 });
  for (const [p, name, roll] of phones) {
    await expect(p.locator(".mp-watch")).toBeVisible({ timeout: 10_000 }); // calibrated (a reloaded phone recalibrates)
    await pose(p, upright(roll));
    await gesture(p, "push");
    await expect(tv.locator(".answered .chip.in", { hasText: name })).toBeVisible({ timeout: 5_000 });
  }
}

test("scan, connect, play: two phones play a full Tamil Trivia match, rematch and reconnect", async ({ browser }) => {
  // 1-3. TV opens, creates a room, shows a QR code and a join code
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  await expect(tv.getByAltText("QR code to join this TV")).toBeVisible();
  const code = await tvCode(tv);
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  const invite = await tvInvite(tv);
  expect(invite.joinCode).toBe(code);

  // 4-6. Phone A joins by typing the code, phone B through the QR invite link
  const a = await newPhonePage(browser);
  await a.goto("/join");
  await a.getByLabel("TV code").fill(code.toLowerCase());
  await a.getByLabel("Your name").fill("Priya");
  await a.getByRole("button", { name: "Peacock" }).click();
  await a.getByRole("button", { name: "Join as guest" }).click();
  await startController(a);
  await expect(a.getByText("You're in!")).toBeVisible();

  const b = await newPhonePage(browser);
  await b.goto(`/join?i=${invite.inviteToken}`);
  await b.getByLabel("Your name").fill("Karthik");
  await b.getByRole("button", { name: "Join as guest" }).click();
  await startController(b);
  await expect(b.getByText("You're in!")).toBeVisible();
  expect(b.url()).not.toContain("i="); // invite token removed from the address bar

  await expect(tv.locator(".player")).toHaveCount(2);
  await expect(tv.locator(".player", { hasText: "Priya" })).toBeVisible();
  await expect(tv.locator(".player", { hasText: "Karthik" })).toBeVisible();

  // 7. pick the game with the remote (arrow keys + Enter) and start it
  await tv.keyboard.press("ArrowRight");
  await tv.locator(".game-card", { hasText: "Tamil Trivia Royale" }).focus();
  await tv.keyboard.press("Enter");
  await tv.getByRole("button", { name: /Start Tamil Trivia Royale/ }).click();

  // 8. phones become motion controllers: calibrate + practise on the TV, then answer by tilt and push
  await practiseUntilReady(tv, a, "Priya", ["push"]);
  await practiseUntilReady(tv, b, "Karthik", ["push"]);
  const both: Array<[Page, string, number]> = [[a, "Priya", -30], [b, "Karthik", 30]];
  for (let q = 1; q <= 3; q++) await answer(tv, both, q);

  // 10. results on TV and phones
  await expect(tv.getByText(/wins!/)).toBeVisible({ timeout: 20_000 });
  await expect(a.getByText(/You won!|You came #/)).toBeVisible();

  // 11. rematch without reloading
  await tv.getByRole("button", { name: /Rematch/ }).click();
  await practiseUntilReady(tv, a, "Priya", ["push"]);
  await practiseUntilReady(tv, b, "Karthik", ["push"]);
  await answer(tv, both, 1);

  // 9. a phone drops out (tab closed / phone locked) and comes back on the same phone with the same identity
  await b.goto("about:blank");
  await expect(tv.getByText(/Question 2 \/ /)).toBeVisible({ timeout: 20_000 });
  const karthikChip = tv.locator(".answered .chip", { hasText: "Karthik" });
  await expect(karthikChip).toHaveClass(/off/);        // still in the match, shown as disconnected
  await b.goto("/join");                               // reopening the site resumes the saved session
  await startController(b);
  await expect(karthikChip).not.toHaveClass(/off/);    // same identity, back in the match
  await expect(tv.locator(".answered .chip")).toHaveCount(2);
  await answer(tv, both, 2);                           // the reloaded phone's gestures count again
  await answer(tv, both, 3);

  await expect(tv.getByText(/wins!/)).toBeVisible({ timeout: 20_000 });
  await tv.getByRole("button", { name: /Choose another game/ }).click();
  await expect(tv.getByText("Choose a game")).toBeVisible();
});

test("wrong and expired codes are explained on the phone", async ({ page }) => {
  await page.goto("/join");
  await page.getByLabel("TV code").fill("ZZZZZ");
  await page.getByLabel("Your name").fill("Test");
  await page.getByRole("button", { name: "Join as guest" }).click();
  await expect(page.getByRole("alert")).toContainText(/expired or is wrong/);
});

test("admin console requires the admin token", async ({ page }) => {
  await page.goto("/admin");
  await page.getByPlaceholder("Admin token").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong admin token")).toBeVisible();
  await page.getByPlaceholder("Admin token").fill("e2e-admin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Active rooms")).toBeVisible();
});

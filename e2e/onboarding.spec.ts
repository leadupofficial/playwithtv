import { expect, test } from "@playwright/test";
import { PHONE, tvCode } from "./helpers";

// The first minute decides whether anyone plays: a phone that opens the site must be steered to "join", the TV's
// join panel must be fully visible above the banner, and a name must never be what stops someone joining.

test("a phone on the home page is offered Join first, and a phone on /tv is stopped before it opens a room", async ({ browser }) => {
  const phone = await (await browser.newContext({ ...PHONE, ignoreHTTPSErrors: true })).newPage();
  await phone.goto("/");
  await expect(phone.getByTestId("phone-join")).toBeVisible();
  await phone.screenshot({ path: "test-results/onboarding-phone-home.png" });

  let rooms = 0;
  phone.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/rooms")) rooms++; });
  await phone.goto("/tv");
  await expect(phone.getByRole("dialog", { name: "This is a phone" })).toBeVisible();
  await phone.waitForTimeout(1500);
  expect(rooms).toBe(0);
  await phone.getByRole("button", { name: /as the screen anyway/ }).click();
  await expect(phone.locator(".code")).toHaveText(/^[A-Z0-9]{5}$/, { timeout: 15_000 });
  expect(rooms).toBeGreaterThan(0); // dev StrictMode mounts twice
});

test("the TV's join panel sits clear of the banner, and a phone joins with no name typed", async ({ browser }) => {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv");
  const code = await tvCode(tv);
  await expect(tv.locator(".ad-slot")).toBeVisible();
  const pair = await tv.locator(".panel.pair").boundingBox();
  const tip = await tv.locator(".wifi-tip").boundingBox();
  const ad = await tv.locator(".ad-slot").boundingBox();
  expect(tip!.y + tip!.height).toBeLessThanOrEqual(pair!.y + pair!.height + 1); // nothing spills out of the panel
  expect(pair!.y + pair!.height).toBeLessThanOrEqual(ad!.y + 1);                 // and the banner never covers it
  await tv.screenshot({ path: "test-results/onboarding-tv-lobby.png" });

  const phone = await (await browser.newContext({ ...PHONE, ignoreHTTPSErrors: true })).newPage();
  await phone.goto("/join");
  await phone.locator("#code").fill(code);
  await phone.getByRole("button", { name: "Elephant" }).click();
  await phone.getByRole("button", { name: "Join as guest" }).click();
  await expect(tv.locator(".player .name")).toHaveText("Elephant", { timeout: 15_000 });
});

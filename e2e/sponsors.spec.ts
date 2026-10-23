import { expect, test } from "@playwright/test";
import { joinPhone, tvCode } from "./helpers";

const ADMIN = { authorization: "Bearer e2e-admin" };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

test("a booked sponsor appears in the lobby banner, the presented-by card and the trivia header", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const created = await request.post("/api/admin/ads", {
    headers: ADMIN,
    data: {
      advertiser: "Anbu Sweets", title: "Anbu Sweets · Karur", line: "Fresh mysorepak every morning",
      placements: ["lobby-rail", "presented-by", "in-game"], startsOn: today(), endsOn: today(),
    },
  });
  expect(created.status()).toBe(201);
  const ad = await created.json();

  try {
    // the admin console lists it
    const admin = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    await admin.goto("/admin");
    await admin.getByPlaceholder("Admin token").fill("e2e-admin");
    await admin.getByRole("button", { name: "Sign in" }).click();
    await expect(admin.locator(".sponsors tr", { hasText: "Anbu Sweets" })).toContainText("running today");

    const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
    await tv.goto("/tv?quick=1");
    const code = await tvCode(tv);
    await expect(tv.locator('.ad-slot[data-placement="lobby-rail"]')).toContainText("Anbu Sweets · Karur");

    await joinPhone(browser, code, "Arun");
    await tv.locator(".game-card", { hasText: "Tamil Trivia" }).click();
    await tv.getByRole("button", { name: /Start Tamil Trivia/ }).click();
    await expect(tv.getByLabel("Presented by Anbu Sweets")).toBeVisible();
    await expect(tv.locator(".sponsor-chip")).toContainText("Anbu Sweets", { timeout: 20_000 });
    await tv.screenshot({ path: "test-results/sponsor-trivia.png" });

    // a game never shows banner rails
    await expect(tv.locator(".ad-slot")).toHaveCount(0);
  } finally {
    await request.delete(`/api/admin/ads/${ad.id}`, { headers: ADMIN });
  }
});

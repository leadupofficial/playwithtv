import { expect, test, type Page } from "@playwright/test";
import { joinPhone, startController, tvCode } from "./helpers";

/** Records Content-Security-Policy violations (the browser fires an event for each blocked thing). */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test("no page breaks under the Content Security Policy (TV lobby, a 3D game, phone, admin, sensors, offline)", async ({ browser }) => {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const tvCsp = await watchCsp(tv);
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const phone = await joinPhone(browser, code, "Csp");
  const phoneCsp = await watchCsp(phone);
  await phone.reload();                       // the session resumes; now watched from the first byte
  await startController(phone);
  await tv.locator(".game-card", { hasText: "Sky Gyro Racer" }).click();
  await tv.getByRole("button", { name: /Start Sky Gyro Racer/ }).click();
  await expect(tv.locator("[data-tutorial]")).toBeVisible({ timeout: 15_000 });
  await tv.waitForTimeout(1500);
  expect(await tvCsp()).toEqual([]);
  expect(await phoneCsp()).toEqual([]);

  for (const path of ["/admin", "/sensors", "/offline.html", "/"]) {
    const p = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    const v = await watchCsp(p);
    await p.goto(path);
    await p.waitForTimeout(800);
    expect(await v(), path).toEqual([]);
  }
});

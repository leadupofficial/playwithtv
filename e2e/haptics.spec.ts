import { expect, test } from "@playwright/test";
import { joinPhone, tvCode } from "./helpers";

test("Vibration can be turned off in the lobby, and the choice is saved on the phone", async ({ browser }) => {
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const phone = await joinPhone(browser, code, "Dev");
  await phone.evaluate(() => {
    (window as unknown as { buzzes: unknown[] }).buzzes = [];
    navigator.vibrate = (p: VibratePattern) => { (window as unknown as { buzzes: unknown[] }).buzzes.push(p); return true; };
  });
  const toggle = phone.getByRole("checkbox", { name: "Vibration" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(await phone.evaluate(() => localStorage.getItem("pwtv.haptics"))).toBe("off");
  await toggle.check();
  expect(await phone.evaluate(() => (window as unknown as { buzzes: unknown[] }).buzzes)).toContain(40); // a test buzz when turned on
  await toggle.uncheck();
  await expect.poll(() => phone.evaluate(() => localStorage.getItem("pwtv.haptics"))).toBe("off");
  await phone.reload();
  expect(await phone.evaluate(() => localStorage.getItem("pwtv.haptics"))).toBe("off");
});

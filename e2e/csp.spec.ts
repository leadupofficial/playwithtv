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

// camera games: a fake camera (test pattern), allowed without a prompt
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("camera play: the phone loads and runs the real body-tracking model (self-hosted wasm) under its CSP", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
  const tvCsp = await watchCsp(tv);
  await tv.goto("/tv?quick=1");
  const code = await tvCode(tv);
  const phone = await joinPhone(browser, code, "Cam");
  const phoneCsp = await watchCsp(phone);
  await phone.reload();
  await startController(phone);
  const origin = new URL(phone.url()).origin;
  const external: string[] = [];
  phone.on("request", (r) => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  await tv.locator(".game-card", { hasText: "Squat Rocket" }).click();
  await tv.getByRole("button", { name: /Start Squat Rocket/ }).click();
  await phone.getByRole("button", { name: /cleared the space/ }).click();
  await phone.getByRole("button", { name: /Turn on camera/ }).click();
  const pad = phone.locator(".cam-pad[data-cam=running]");
  await expect(pad).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => Number(await pad.getAttribute("data-fps")), { timeout: 15_000 }).toBeGreaterThan(3);
  await phone.waitForTimeout(4000);
  const info = { fps: await pad.getAttribute("data-fps"), inferMs: await pad.getAttribute("data-infer"), delegate: await pad.getAttribute("data-delegate"), track: await pad.getAttribute("data-track") };
  test.info().annotations.push({ type: "pose-model", description: JSON.stringify(info) });
  console.log("pose model in headless Chromium:", JSON.stringify(info));
  expect(info.track).toBe("need-body"); // the fake camera shows nobody
  expect(external).toEqual([]);         // nothing leaves this origin (no CDN, no telemetry)
  expect(await phoneCsp()).toEqual([]);
  expect(await tvCsp()).toEqual([]);
});

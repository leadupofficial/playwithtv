import { expect, test } from "@playwright/test";
import { newPhonePage, startController, tvCode } from "./helpers";

/** A stand-in for navigator.wakeLock (headless browsers have no screen to keep on): records requests. */
function fakeWakeLock() {
  const w = window as unknown as { __wake: { requests: number; current: { released: boolean; cbs: Array<() => void> } | null; releaseNow(): void } };
  w.__wake = {
    requests: 0,
    current: null,
    releaseNow() {
      const s = this.current;
      if (!s) return;
      s.released = true;
      s.cbs.forEach((cb) => cb());
    },
  };
  Object.defineProperty(navigator, "wakeLock", {
    value: {
      request: async () => {
        w.__wake.requests++;
        const s = { released: false, cbs: [] as Array<() => void>, release: async () => undefined, addEventListener: (_: string, cb: () => void) => s.cbs.push(cb) };
        w.__wake.current = s;
        return s;
      },
    },
  });
}

test("the phone keeps its screen on during play, and asks again after the screen lock is released", async ({ browser }) => {
  const tv = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await tv.goto("/tv");
  const code = await tvCode(tv);
  const phone = await newPhonePage(browser);
  await phone.addInitScript(fakeWakeLock);
  await phone.goto("/join");
  await phone.getByLabel("TV code").fill(code);
  await phone.getByLabel("Your name").fill("Wake");
  await phone.getByRole("button", { name: "Join as guest" }).click();
  await startController(phone);

  const ctl = phone.locator(".phone.controller");
  await expect(ctl).toHaveAttribute("data-wake", "on");
  await expect(phone.locator(".wake-hint")).toHaveCount(0);
  // the background video that keeps Chrome awake even without the API: playing, muted, big and fully on screen
  const video = await phone.locator("video.keep-awake").evaluate((v: HTMLVideoElement) => {
    const r = v.getBoundingClientRect();
    return {
      playing: !v.paused && v.readyState >= 2, muted: v.muted,
      share: (r.width * r.height) / (innerWidth * innerHeight),
      inView: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
    };
  });
  expect(video).toMatchObject({ playing: true, muted: true, inView: true });
  expect(video.share).toBeGreaterThan(0.2); // Chrome's video wake lock needs ≥ 20 % of the viewport
  await phone.screenshot({ path: "test-results/phone-controller.png" });
  const requests = () => phone.evaluate(() => (window as unknown as { __wake: { requests: number } }).__wake.requests);
  expect(await requests()).toBe(1);

  // the browser drops the lock (screen hidden / tab switched), then the page is visible again
  await phone.evaluate(() => (window as unknown as { __wake: { releaseNow(): void } }).__wake.releaseNow());
  await expect(ctl).toHaveAttribute("data-wake", "off");
  await expect(phone.locator(".wake-hint")).toBeVisible();
  await phone.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(ctl).toHaveAttribute("data-wake", "on");
  expect(await requests()).toBe(2);
});

import { defineConfig, devices } from "@playwright/test";

/**
 * Read-only checks against the live site (no local server): `pnpm exec playwright test -c playwright.live.config.ts
 * e2e/smoke-all.spec.ts`. Override the address with LIVE_URL.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.LIVE_URL ?? "https://playwithtv.leadup.in", trace: "retain-on-failure", actionTimeout: 10_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

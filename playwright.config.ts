import { defineConfig, devices } from "@playwright/test";

/**
 * Runs the real hub (in-memory storage) and the Vite web app, then drives a TV page and phone pages.
 * PW_HUB_PORT / PW_WEB_PORT let several checkouts run their suites at the same time.
 */
const HUB = Number(process.env.PW_HUB_PORT ?? 8080);
const WEB = Number(process.env.PW_WEB_PORT ?? 5173);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // HTTPS like the real setup: phones only allow motion sensors on secure pages.
  use: { baseURL: `https://localhost:${WEB}`, ignoreHTTPSErrors: true, trace: "retain-on-failure", actionTimeout: 10_000 },
  webServer: [
    {
      command: "pnpm --filter @playwithtv/server start",
      url: `http://localhost:${HUB}/healthz`,
      env: { PORT: String(HUB), PUBLIC_URL: `https://localhost:${WEB}`, ADMIN_TOKEN: "e2e-admin", PREVIEW_GAMES: "1" }, // held-back games stay under test
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @playwithtv/web dev --strictPort",
      url: `https://localhost:${WEB}`,
      ignoreHTTPSErrors: true,
      env: { HTTPS: "1", WEB_PORT: String(WEB), HUB_URL: `http://localhost:${HUB}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

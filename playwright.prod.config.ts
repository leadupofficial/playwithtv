import { defineConfig, devices } from "@playwright/test";

/**
 * The same end-to-end suite against the production build: the hub serves the built web app with every
 * security header (CSP, permissions policy, ...) active, exactly as deployed. localhost counts as a secure
 * page, so phones get motion sensors without certificates.
 */
const PORT = Number(process.env.PW_HUB_PORT ?? 8080);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  // GitHub's shared runners are slow and noisy: one retry there, and a test that only passes on the retry is
  // reported as flaky (never silently green). Locally a failure is a failure.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", actionTimeout: 10_000 },
  webServer: {
    command: "pnpm --filter @playwithtv/web build && pnpm --filter @playwithtv/server start",
    url: `http://localhost:${PORT}/healthz`,
    env: { PORT: String(PORT), PUBLIC_URL: `http://localhost:${PORT}`, ALLOWED_ORIGINS: `http://localhost:${PORT}`, ADMIN_TOKEN: "e2e-admin" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

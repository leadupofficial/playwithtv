import { defineConfig, devices } from "@playwright/test";

/** Runs the real hub (in-memory storage) and the Vite web app, then drives a TV page and phone pages. */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // HTTPS like the real setup: phones only allow motion sensors on secure pages.
  use: { baseURL: "https://localhost:5173", ignoreHTTPSErrors: true, trace: "retain-on-failure", actionTimeout: 10_000 },
  webServer: [
    {
      command: "pnpm --filter @playwithtv/server start",
      url: "http://localhost:8080/healthz",
      env: { PORT: "8080", PUBLIC_URL: "https://localhost:5173", ADMIN_TOKEN: "e2e-admin" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @playwithtv/web dev --strictPort",
      url: "https://localhost:5173",
      ignoreHTTPSErrors: true,
      env: { HTTPS: "1" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

import { defineConfig, devices } from "@playwright/test";

/**
 * The same end-to-end suite against the production build: the hub serves the built web app with every
 * security header (CSP, permissions policy, ...) active, exactly as deployed. localhost counts as a secure
 * page, so phones get motion sensors without certificates.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:8080", trace: "retain-on-failure", actionTimeout: 10_000 },
  webServer: {
    command: "pnpm --filter @scp/web build && pnpm --filter @scp/server start",
    url: "http://localhost:8080/healthz",
    env: { PORT: "8080", PUBLIC_URL: "http://localhost:8080", ALLOWED_ORIGINS: "http://localhost:8080", ADMIN_TOKEN: "e2e-admin" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

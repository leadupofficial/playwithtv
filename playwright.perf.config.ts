import { defineConfig, devices } from "@playwright/test";
import prod from "./playwright.prod.config";

/**
 * Performance budgets for every playable game (e2e/budget.perf.ts) against the production build.
 * `pnpm perf` — kept out of the normal e2e run (it plays every game) and run as its own CI job.
 */
export default defineConfig({
  ...prod,
  testMatch: /.*\.perf\.ts$/,
  reporter: [["list"]],
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      // a fixed GPU path so numbers are comparable run to run (CI has no GPU either)
      launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"] },
    },
  }],
});

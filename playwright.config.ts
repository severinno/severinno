import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E Configuration — Severinno Marketplace
 *
 * Run:      bun run e2e              (headless)
 *          bun run e2e:ui           (Playwright UI mode)
 *          bun run test:e2e:a11y    (accessibility audit only)
 *
 * The dev server should be running on port 3000 before tests.
 * For CI, set CI=true and the webServer config will auto-start.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    // Mobile viewports
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 9"] },
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 16"] },
    },
  ],
  // Auto-start the dev server in CI (assumes `bun run dev` in background for local)
  webServer: process.env.CI
    ? {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
})

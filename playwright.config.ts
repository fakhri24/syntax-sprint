import { defineConfig, devices } from "@playwright/test";

// Playwright owns everything that jsdom cannot reach: real keyboard layouts,
// dead keys, IME composition, and iframe/Shadow DOM stage behaviour (AGENTS.md §4.1).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A dedicated port, not 3000: reuseExistingServer would otherwise happily bind
  // to whatever unrelated dev server happens to hold the default port and run the
  // whole suite against the wrong app.
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
  },
});

import { defineConfig, devices, chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const baseURL = `http://127.0.0.1:${process.env.FRAME_PORT || 5178}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  use: {
    ...devices["Desktop Chrome"],
    channel:
      process.env.FRAME_BROWSER_CHANNEL === "chromium"
        ? undefined
        : process.env.FRAME_BROWSER_CHANNEL ||
          (existsSync(chromium.executablePath()) ? undefined : "chrome"),
    baseURL,
    viewport: { width: 1440, height: 1100 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    acceptDownloads: true,
    // A silent null output keeps media clocks running even when the machine's speakers are
    // unavailable, and keeps test runs quiet.
    launchOptions: { args: ["--disable-audio-output"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});

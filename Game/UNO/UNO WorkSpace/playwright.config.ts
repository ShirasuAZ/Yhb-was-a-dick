import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright",
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3199",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run build && node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:3199/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      HOST: "127.0.0.1",
      UNO_DATA_DIR: "test-results/e2e-data"
    }
  }
});

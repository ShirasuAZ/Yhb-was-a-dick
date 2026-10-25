/**
 * The Arknights full-flow check in the installed Microsoft Edge (channel "msedge"): npx playwright test -c playwright.edge.config.ts
 * Same server as playwright.config.ts; only tests/e2e/*.edge.ts run here.
 */
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testMatch: /\.edge\.ts$/,
  timeout: 30 * 60_000,
  // SLOWMO=<ms> slows every action down, to watch a headed run (npx playwright test -c playwright.edge.config.ts --headed).
  use: { ...base.use, channel: "msedge", viewport: { width: 1440, height: 900 }, screenshot: "only-on-failure", launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) } }
});

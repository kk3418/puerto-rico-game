import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5179",
    locale: "en-US",
  },
  webServer: {
    command: "tsx e2e/serve.ts",
    url: "http://127.0.0.1:5179",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

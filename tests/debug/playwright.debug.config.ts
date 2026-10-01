import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: ".", timeout: 60000, use: { ...devices["Desktop Chrome"] } });

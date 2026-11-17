import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/mobile", workers: 1, timeout: 60000,
  outputDir: ".verification/mobile-test-results",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [{ name: "mobile-web", use: { ...devices["Pixel 7"] } }],
  webServer: { command: "npm run mobile:dev", url: "http://127.0.0.1:5173", reuseExistingServer: false,
    env: { NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED: "false", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", VITE_API_BASE_URL: "" } },
});

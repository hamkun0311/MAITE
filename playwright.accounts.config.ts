import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/accounts-browser", workers: 1, timeout: 60000,
  outputDir: ".verification/accounts-test-results",
  use: { baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure" },
  projects: [{ name: "accounts", use: { ...devices["Pixel 7"] } }],
  webServer: { command: "npm run dev -- --hostname 127.0.0.1 --port 3101", url: "http://127.0.0.1:3101", reuseExistingServer: false, timeout: 120000,
    env: { MAITE_TEST_MODE: "1", OPENAI_API_KEY: "", ACCOUNT_FEATURES_ENABLED: "true", NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key" } },
});

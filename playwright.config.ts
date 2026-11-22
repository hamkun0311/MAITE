import { defineConfig, devices } from "@playwright/test";

const testPort = process.env.PLAYWRIGHT_PORT || "3100";
const testUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 150000,
  workers: 1,
  use: { baseURL: testUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${testPort}`,
    url: testUrl,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      MAITE_TEST_MODE: "1",
      // These browser fixtures exercise demo mode, independently of .env.local.
      ACCOUNT_FEATURES_ENABLED: "false",
      NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED: "false",
      OPENAI_API_KEY: "",
      OPENAI_TEXT_PROVIDER: "",
      OPENAI_BASE_URL: "",
      OPENAI_TEXT_API_KEY: "",
      OPENAI_IMAGE_BASE_URL: "",
      OPENAI_IMAGE_API_KEY: "",
      OPENAI_IMAGE_PROVIDER: "",
      OPENAI_IMAGE_DIRECT_API_KEY: "",
      GEMINI_API_KEY: "",
      GEMINI_PROVIDER: "",
      GEMINI_DIRECT_API_KEY: "",
      GEMINI_BASE_URL: "",
      GEMINI_NOVEL_WRITE_MODEL: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      CLOUDFLARE_API_TOKEN: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});

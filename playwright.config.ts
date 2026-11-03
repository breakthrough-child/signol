import { defineConfig, devices } from "@playwright/test";

/**
 * Three servers:
 *  - fake LLM (Groq + Gemini HTTP fakes)
 *  - app on :3100  -> primary Groq adapter talks to the fake
 *  - app on :3101  -> LLM_FORCE_FAIL=groq, so every call must fall back to the Gemini adapter
 * The Supabase side comes from `node scripts/local-stack/stack.mjs up` (real Postgres + the real migrations).
 */
const llmEnv = {
  GROQ_API_KEY: "fake-groq-key",
  GEMINI_API_KEY: "fake-gemini-key",
  GROQ_BASE_URL: "http://127.0.0.1:4010/openai/v1",
  GEMINI_BASE_URL: "http://127.0.0.1:4010/v1beta",
  LLM_PROVIDER_ORDER: "groq,gemini",
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Set PW_CHROMIUM to use a pre-installed Chromium (e.g. in CI sandboxes) instead of `npx playwright install`.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM, args: ["--no-sandbox"] } : {},
  },
  projects: [
    { name: "primary", use: { baseURL: "http://127.0.0.1:3100" }, testMatch: /(flow|own-project)\.spec\.ts/ },
    { name: "fallback", use: { baseURL: "http://127.0.0.1:3101" }, testMatch: /fallback\.spec\.ts/ },
  ],
  webServer: [
    { command: "npx tsx tests/e2e/fake-llm.ts", url: "http://127.0.0.1:4010/__stats", reuseExistingServer: true, timeout: 60_000 },
    { command: "npx next start -p 3100", url: "http://127.0.0.1:3100", reuseExistingServer: true, timeout: 120_000, env: llmEnv },
    { command: "npx next start -p 3101", url: "http://127.0.0.1:3101", reuseExistingServer: true, timeout: 120_000, env: { ...llmEnv, LLM_FORCE_FAIL: "groq" } },
  ],
});

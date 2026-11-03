import { expect, test } from "@playwright/test";

/** Groq is forced to fail (LLM_FORCE_FAIL=groq), so every model call must succeed through the Gemini adapter. */
test("analysis completes through the Gemini fallback when Groq fails", async ({ page, request }) => {
  const before = await (await request.get("http://127.0.0.1:4010/__stats")).json();
  await page.goto("/");
  await page.getByTestId("try-demo").click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  await page.getByTestId("ack-lock").check();
  await page.getByTestId("start-analysis").click();
  await expect(page.getByTestId("to-board")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("to-board").click();
  await expect(page.getByTestId("verified-badge")).toContainText("quotes verified");

  const after = await (await request.get("http://127.0.0.1:4010/__stats")).json();
  expect(after.groq).toBe(before.groq); // Groq was never contacted
  expect(after.gemini).toBeGreaterThan(before.gemini + 10);

  // run logs record the provider actually used
  await page.goto("/stats");
  await expect(page.getByRole("cell", { name: "gemini" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "groq" })).toHaveCount(0);
});

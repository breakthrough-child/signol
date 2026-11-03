import { expect, test } from "@playwright/test";

/**
 * The full demo flow a judge would follow, with live pipeline steps (real Groq adapter over HTTP to a fake).
 * Create demo -> Checkpoint 1 -> analysis -> evidence board -> filters -> transcript highlight
 * -> Checkpoint 2 with friction -> calibration -> exports, share link, next-interview script, stats.
 */
test("demo: full flow with both human checkpoints", async ({ page, browser, request }) => {
  // ---- landing + demo, no sign-up
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Face the evidence");
  await page.getByTestId("try-demo").click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  const projectId = projectUrl.split("/p/")[1];

  // ---- Checkpoint 1: pre-filled hypothesis and prediction, six interviews loaded
  await expect(page.locator("#hyp")).toHaveValue(/Small restaurant owners in Lagos/);
  await expect(page.locator("#sup")).toHaveValue("5");
  await expect(page.getByText("Interview 6: Ngozi")).toBeVisible();
  await expect(page.getByTestId("start-analysis")).toBeDisabled();
  await page.getByTestId("ack-lock").check();
  await page.getByTestId("start-analysis").click();

  // ---- analysis pipeline (visible progress)
  await page.waitForURL(/\/analyze$/);
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByTestId("to-board")).toBeVisible({ timeout: 120_000 });

  // locked: the DB refuses edits even if the UI is bypassed
  await page.goto(projectUrl);
  await expect(page.locator("#hyp")).toBeDisabled();
  const patch = await page.request.patch(`/api/projects/${projectId}`, { data: { hypothesis: "Changed my mind after seeing the evidence" } });
  expect(patch.status()).toBe(409);

  // ---- evidence board
  await page.goto(`/p/${projectId}/board`);
  await expect(page.getByTestId("headline")).toContainText("% of your positive feedback was compliments or promises, not evidence");
  await expect(page.getByTestId("verified-badge")).toContainText("quotes verified");
  const verifiedText = (await page.getByTestId("verified-badge").textContent()) ?? "";
  const m = verifiedText.match(/(\d+)\/(\d+)/);
  expect(Number(m![1])).toBeGreaterThan(10);
  await expect(page.getByTestId("col-for").getByTestId("evidence-card").first()).toBeVisible();
  await expect(page.getByTestId("col-against").getByTestId("evidence-card").first()).toBeVisible();
  await expect(page.getByTestId("leading-card").first()).toContainText("Neutral rewrite");
  expect(await page.getByTestId("leading-card").count()).toBeGreaterThanOrEqual(3);

  // filters
  await page.getByRole("button", { name: "Past behavior" }).click();
  const types = await page.getByTestId("evidence-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-type")));
  expect(types.length).toBeGreaterThan(0);
  expect(new Set(types)).toEqual(new Set(["past_behavior"]));
  await page.getByLabel("Stance").selectOption("contradicts");
  const stances = await page.getByTestId("evidence-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-stance")));
  expect(new Set(stances)).toEqual(new Set(["contradicts"]));
  await page.getByRole("button", { name: "Clear filters" }).click();

  // "view in transcript" highlights the exact quote
  const first = page.getByTestId("col-against").getByTestId("evidence-card").first();
  const quote = (await first.locator("blockquote").textContent())!.replace(/[“”]/g, "").trim();
  await first.getByRole("link", { name: /View in transcript/ }).click();
  await expect(page.locator("mark#selected-quote")).toBeVisible();
  const marked = (await page.locator("mark#selected-quote").textContent())!.trim();
  expect(quote.replace(/\s+/g, " ")).toBe(marked.replace(/\s+/g, " "));

  // ---- Checkpoint 2: friction
  await page.goto(`/p/${projectId}/decide`);
  await page.getByTestId("choice-validated").check({ force: true });
  await expect(page.getByTestId("submit-decision")).toBeDisabled();
  const cards = page.getByTestId("friction-card");
  await expect(cards).toHaveCount(3);
  // writing responses without opening is not possible (textareas are inside closed <details>)
  await expect(page.getByTestId("friction-response").first()).toBeHidden();
  for (let i = 0; i < 3; i++) {
    await cards.nth(i).locator("summary").click();
    await cards.nth(i).getByTestId("friction-response").fill(i === 0 ? "ok" : "This is real behavior and it worries me about adoption.");
  }
  await expect(page.getByTestId("submit-decision")).toBeDisabled(); // first response is a one-word filler
  await cards.nth(0).getByTestId("friction-response").fill("He tried it and deleted it, so willingness to pay is not enough.");
  await expect(page.getByTestId("submit-decision")).toBeEnabled();

  // the server enforces friction too
  const bypass = await page.request.post(`/api/projects/${projectId}/decision`, { data: { choice: "validated", responses: [] } });
  expect(bypass.status()).toBe(422);

  await page.getByTestId("submit-decision").click();
  await expect(page.getByTestId("calibration")).toBeVisible();
  await expect(page.getByTestId("reflection")).toContainText("predicted 5 of 6");
  await expect(page.getByTestId("reflection")).not.toContainText(/wrong|failed|bad/i);

  // decision is final
  const again = await page.request.post(`/api/projects/${projectId}/decision`, { data: { choice: "need_more_evidence", responses: [] } });
  expect(again.status()).toBe(409);

  // ---- outputs
  await page.getByTestId("to-outputs").click();
  await expect(page.getByTestId("decision-log")).toContainText("Validated");
  await expect(page.getByTestId("decision-log")).toContainText("This is real behavior and it worries me");

  const md = await page.request.get(`/api/projects/${projectId}/export?doc=log&format=md`);
  expect(md.status()).toBe(200);
  const mdText = await md.text();
  expect(mdText).toContain("# Decision log:");
  expect(mdText).toContain("Pre-committed prediction");
  const pdf = await page.request.get(`/api/projects/${projectId}/export?doc=log&format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // read-only share link works without any session
  await page.getByTestId("create-share").click();
  const shareUrl = await page.getByTestId("share-url").inputValue();
  expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]{30,}$/);
  const anon = await browser.newContext();
  const sp = await anon.newPage();
  await sp.goto(shareUrl.replace(/^https?:\/\/[^/]+/, "http://127.0.0.1:3100"));
  await expect(sp.getByTestId("decision-log")).toContainText("Lagos restaurants");
  await expect(sp.getByRole("link", { name: "Transcript" })).toHaveCount(0);
  await sp.goto("http://127.0.0.1:3100/s/not-a-real-token-0000000000000000");
  await expect(sp.getByText("This link is not valid")).toBeVisible();
  await anon.close();

  // next interview script
  await page.getByTestId("gen-script").click();
  await expect(page.getByTestId("script")).toBeVisible();
  await expect(page.getByTestId("script")).toContainText("Rewritten");
  const sm = await page.request.get(`/api/projects/${projectId}/export?doc=script&format=md`);
  expect(await sm.text()).toContain("New questions");

  // ---- stats page
  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Time saved and model usage" })).toBeVisible();
  await expect(page.getByText("Your model calls")).toBeVisible();
  await expect(page.getByRole("cell", { name: "classify" }).first()).toBeVisible();
  void request;
});

test("demo: cached analysis path and 'need more evidence' has no friction", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("try-demo").click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  const id = page.url().split("/p/")[1];
  await page.getByTestId("ack-lock").check();
  await page.getByTestId("use-cached").click();
  await page.waitForURL(/\/board$/);
  await expect(page.getByText("Cached demo analysis")).toBeVisible();
  // quotes in the cache are verified by code against the transcripts
  const t = (await page.getByTestId("verified-badge").textContent())!.match(/(\d+)\/(\d+)/)!;
  expect(t[1]).toBe(t[2]);
  await expect(page.getByTestId("headline-pct")).toHaveText("71%");

  await page.goto(`/p/${id}/decide`);
  await page.getByTestId("choice-need_more_evidence").check({ force: true });
  await expect(page.getByTestId("friction-card")).toHaveCount(0);
  await page.getByTestId("submit-decision").click();
  await expect(page.getByTestId("calibration")).toBeVisible();
  await expect(page.getByTestId("reflection")).toContainText("predicted 5 of 6");
  await expect(page.getByTestId("reflection")).toContainText("3 showed strong supporting evidence");
});

test("a visitor cannot open another session's project", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByTestId("try-demo").click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  const url = page.url();
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(url);
  await expect(p2.getByText(/could not find this project/i)).toBeVisible();
  await other.close();
});

test("mobile layout works without horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, baseURL: "http://127.0.0.1:3100" });
  const p = await ctx.newPage();
  await p.goto("/");
  const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(w.sw).toBeLessThanOrEqual(w.cw);
  await expect(p.getByTestId("try-demo")).toBeVisible();
  await ctx.close();
});

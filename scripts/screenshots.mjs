// Captures README screenshots from a running instance: BASE=http://127.0.0.1:3100 PW_CHROMIUM=... node scripts/screenshots.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const out = new URL("../docs/screenshots/", import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
const page = await ctx.newPage();
const shot = async (name, full = false) => page.screenshot({ path: `${out}${name}.png`, fullPage: full });

await page.goto(BASE + "/");
await shot("01-landing", true);
await page.getByTestId("try-demo").click();
await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
const id = page.url().split("/p/")[1]; void id;
await page.waitForSelector("#hyp");
await shot("02-precommit", true);
await page.getByTestId("ack-lock").check();
await page.getByTestId("start-analysis").click();
await page.waitForURL(/analyze/);
await page.waitForSelector('[data-testid="to-board"]', { timeout: 120000 });
await shot("03-analysis", true);
// the remaining screenshots use the cached demo analysis (curated content), clearly labelled in the UI
await page.goto(BASE + "/");
await page.getByTestId("try-demo").click();
await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
const id2 = page.url().split("/p/")[1];
await page.getByTestId("ack-lock").check();
await page.getByTestId("use-cached").click();
await page.waitForURL(/board$/);
await page.goto(`${BASE}/p/${id2}/board`);
await page.waitForSelector('[data-testid="headline"]');
await shot("04-evidence-board", true);
await page.goto(`${BASE}/p/${id2}/decide`);
await page.getByTestId("choice-validated").check({ force: true });
const cards = page.getByTestId("friction-card");
for (let i = 0; i < 3; i++) {
  await cards.nth(i).locator("summary").click();
  if (i < 2) await cards.nth(i).getByTestId("friction-response").fill("This is concrete behavior that I have to take seriously before I call this validated.");
}
await shot("05-decision-friction", true);
await cards.nth(2).getByTestId("friction-response").fill("Even a paying customer never used the stock module, so paying does not mean using.");
await page.getByTestId("submit-decision").click();
await page.waitForSelector('[data-testid="calibration"]');
await shot("06-calibration", true);
await page.goto(`${BASE}/p/${id2}/outputs`);
await page.waitForSelector('[data-testid="decision-log"]');
await page.getByTestId("gen-script").click();
await page.waitForSelector('[data-testid="script"]');
await shot("07-outputs", true);
await page.goto(`${BASE}/stats`);
await page.waitForSelector("text=Your model calls");
await shot("08-stats", true);
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mobile.newPage();
await mp.goto(BASE + "/");
await mp.screenshot({ path: `${out}09-mobile-landing.png` });
await browser.close();
console.log("saved to", out);

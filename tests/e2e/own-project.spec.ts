import { expect, test } from "@playwright/test";
import JSZip from "jszip";

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split("\n").map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("own project: paste (ambiguous speakers), .txt, .docx and audio uploads, speaker confirmation, full analysis", async ({ page }) => {
  await page.goto("/new");
  await page.getByLabel("Hypothesis", { exact: true }).fill("Cafe owners in Accra will pay monthly for automated stock counts");
  await page.getByLabel("Target customer").fill("Owners of small cafes");
  await page.getByLabel("Project name (optional)").fill("Accra cafes");
  await page.getByLabel("How many of your interviewees will support the hypothesis?").fill("2");
  await page.getByRole("button", { name: "Save and add interviews" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  const id = page.url().split("/p/")[1];

  // 1. pasted transcript where roles cannot be told apart
  await page.getByLabel("Label", { exact: true }).fill("Interview 1");
  await page.getByLabel("Transcript or notes").fill(
    `Ada: We talked about stock yesterday. I think it matters a lot for cafes.\nKofi: Yes it matters a lot to us here, we count the milk every morning.\nAda: Right, that is what I heard too from others in the area.\nKofi: Last week we ran out of oat milk on Saturday and customers left.`,
  );
  await page.getByRole("button", { name: "Add interview" }).click();
  await expect(page.getByText("Interview 1").first()).toBeVisible();

  // 2. .txt notes upload (goes to the private bucket, then is read back by the server)
  await page.getByRole("tab", { name: "Upload file or audio" }).click();
  await page.locator("#iv-file").setInputFiles({ name: "kwame-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Kwame runs a cafe near the harbour.\n\nHe writes every delivery in a notebook and loses about an hour each night reconciling it.\n\nHe tried a spreadsheet last year but stopped after two weeks.") });
  await expect(page.getByText("kwame notes")).toBeVisible();

  // 3. .docx upload
  await page.locator("#iv-file").setInputFiles({ name: "abena.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await makeDocx("Abena owns a bakery cafe in Osu and counts stock by eye each morning before opening.\nShe says she has never run out of flour in three years and would not pay for an app.") });
  await expect(page.getByText("abena", { exact: true })).toBeVisible();

  // 4. audio upload (stored now, transcribed during analysis)
  await page.locator("#iv-file").setInputFiles({ name: "ama.mp3", mimeType: "audio/mpeg", buffer: Buffer.alloc(2048, 1) });
  await expect(page.getByText("Audio, transcribed at analysis")).toBeVisible();

  // unsupported type is refused with a friendly message
  await page.locator("#iv-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("x") });
  await expect(page.getByText(/is not supported/)).toBeVisible();

  // prediction larger than interview count blocks the lock
  await page.locator("#sup").fill("9");
  await expect(page.getByText(/You predicted 9 supporters but have 4 interviews/)).toBeVisible();
  await page.locator("#sup").fill("2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.getByTestId("ack-lock").check();
  await page.getByTestId("start-analysis").click();
  await page.waitForURL(/\/analyze$/);

  // the pipeline pauses and asks who the interviewer is
  await expect(page.getByText(/Who is the interviewer in "Interview 1"/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("radio", { name: /Ada/ }).check();
  await page.getByRole("button", { name: "Confirm and continue" }).click();

  await expect(page.getByTestId("to-board")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Transcribed with groq/)).toBeVisible();

  await page.getByTestId("to-board").click();
  await expect(page.getByTestId("verified-badge")).toContainText("quotes verified");
  const sel = page.getByLabel("Interview", { exact: true });
  await expect(sel.locator("option")).toHaveCount(5); // all + 4 interviews
  void id;
});

test("empty / irrelevant interviews are rejected with a clear message", async ({ page }) => {
  await page.goto("/new");
  await page.getByLabel("Hypothesis", { exact: true }).fill("Cafe owners will pay for something");
  await page.getByLabel("Target customer").fill("Cafe owners");
  await page.getByRole("button", { name: "Save and add interviews" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  await page.getByLabel("Transcript or notes").fill("hi hi hi hi hi hi hi hi hi hi hi hi");
  await page.getByRole("button", { name: "Add interview" }).click();
  await expect(page.getByText(/Interview 1|Interview/).first()).toBeVisible();
  await page.locator("#sup").fill("1");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByTestId("ack-lock").check();
  await page.getByTestId("start-analysis").click();
  await page.waitForURL(/\/analyze$/);
  await expect(page.getByText(/empty or too short to analyse/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("retry")).toBeVisible();
});

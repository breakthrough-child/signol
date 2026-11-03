/**
 * A fake of the Groq (OpenAI-compatible) and Gemini HTTP APIs, used only by the end-to-end tests.
 * The REAL adapters talk to it over HTTP, so request/response shapes, auth headers and fallback are exercised
 * for real. Answers come from the heuristic logic in lib/llm/mock.ts, reconstructed from the prompt text
 * (the same text a real model would receive).
 *
 *   npx tsx tests/e2e/fake-llm.ts            # port 4010
 */
import http from "node:http";
import { mockClassify, mockLeading, mockScript, mockSynthesize } from "../../lib/llm/mock";
import type { Turn } from "../../lib/types";

const PORT = Number(process.env.FAKE_LLM_PORT ?? 4010);
const stats = { groq: 0, gemini: 0 };

function turnsFrom(user: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of user.split("\n")) {
    const m = line.match(/^\[(\d+)\] (INTERVIEWER|INTERVIEWEE) \(([^)]*)\): (.*)$/);
    if (m) turns.push({ idx: Number(m[1]), role: m[2] === "INTERVIEWER" ? "interviewer" : "interviewee", speaker: m[3], text: m[4] });
    const q = line.match(/^\[(\d+)\] INTERVIEWER: (.*)$/);
    if (q) turns.push({ idx: Number(q[1]), role: "interviewer", speaker: "Interviewer", text: q[2] });
    const a = line.match(/-> next interviewee turn \[(\d+)\] begins: "(.*)"$/);
    if (a) turns.push({ idx: Number(a[1]), role: "interviewee", speaker: "x", text: a[2] });
  }
  return turns.sort((x, y) => x.idx - y.idx);
}

function answer(system: string, user: string): unknown {
  if (system.includes("evidence analyst")) return mockClassify({ turns: turnsFrom(user) });
  if (system.includes("The Mom Test")) return mockLeading({ turns: turnsFrom(user) });
  if (system.includes("synthesise VERIFIED")) {
    const items = user
      .split("\n")
      .map((l) => l.match(/^([0-9a-f-]{36}) \| (.*?) \| (\w+) \| (\w+) \| weight ([\d.]+)( \(tainted[^)]*\))? \| "(.*)"$/))
      .filter(Boolean)
      .map((m) => ({ id: m![1], interview: m![2], type: m![3], stance: m![4], weight: Number(m![5]), tainted: Boolean(m![6]), quote: m![7] }));
    const cf = JSON.parse(user.match(/CANDIDATES_FOR: (\[.*\])/)?.[1] ?? "[]");
    const ca = JSON.parse(user.match(/CANDIDATES_AGAINST: (\[.*\])/)?.[1] ?? "[]");
    return mockSynthesize({ items, candidatesFor: cf, candidatesAgainst: ca });
  }
  if (system.includes("NEXT customer-discovery interview")) return mockScript();
  return {};
}

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const isJson = String(req.headers["content-type"] ?? "").includes("json");
  const body = chunks.length && isJson ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const send = (code: number, obj: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(obj));
  };
  const url = req.url ?? "";
  if (url === "/__stats") return send(200, stats);

  if (url.endsWith("/openai/v1/audio/transcriptions")) {
    stats.groq++;
    if (req.headers.authorization !== "Bearer fake-groq-key") return send(401, { error: "bad key" });
    // Real Whisper returns plain text without speaker labels
    return send(200, {
      text: "How do you keep track of your stock today? We write everything in a notebook every night and my sister checks it against the receipts. Last month we ran out of rice on a Friday afternoon and I had to buy it at retail price. I think most owners around here do the same thing.",
      duration: 41.2,
    });
  }
  if (url.endsWith("/openai/v1/chat/completions")) {
    stats.groq++;
    if (req.headers.authorization !== "Bearer fake-groq-key") return send(401, { error: "bad key" });
    if (body.response_format?.type !== "json_object") return send(400, { error: "json mode required" });
    const [sys, usr] = [body.messages[0].content, body.messages[1].content];
    const text = JSON.stringify(answer(sys, usr));
    return send(200, { choices: [{ message: { content: text } }], usage: { prompt_tokens: Math.ceil((sys.length + usr.length) / 4), completion_tokens: Math.ceil(text.length / 4) } });
  }
  const g = url.match(/\/v1beta\/models\/([^:]+):generateContent/);
  if (g) {
    stats.gemini++;
    if (req.headers["x-goog-api-key"] !== "fake-gemini-key") return send(403, { error: "bad key" });
    if (body.generationConfig?.responseMimeType !== "application/json") return send(400, { error: "json mime required" });
    const sys = body.systemInstruction.parts[0].text;
    const usr = body.contents[0].parts[0].text;
    const text = JSON.stringify(answer(sys, usr));
    return send(200, { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: Math.ceil((sys.length + usr.length) / 4), candidatesTokenCount: Math.ceil(text.length / 4) } });
  }
  send(404, { error: "not found", url });
});
server.listen(PORT, "127.0.0.1", () => console.log(`fake llm on :${PORT}`));

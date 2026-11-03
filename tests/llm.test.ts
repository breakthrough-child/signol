import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlmClient, extractJson } from "@/lib/llm/client";
import { createGroqAdapter } from "@/lib/llm/groq";
import { createGeminiAdapter } from "@/lib/llm/gemini";
import { createMockAdapter } from "@/lib/llm/mock";
import { LlmProviderError, type LlmAdapter, type LlmEvent, type LlmLog } from "@/lib/llm/types";

const schema = z.object({ ok: z.boolean() });
const call = { step: "t", task: "other" as const, system: "s", user: "u", schema };

function adapter(name: string, impl: () => Promise<string>): LlmAdapter & { calls: number } {
  const a = {
    name,
    calls: 0,
    isConfigured: () => true,
    async chat() {
      a.calls++;
      const text = await impl();
      return { text, provider: name, model: `${name}-m`, tokensIn: 10, tokensOut: 5, latencyMs: 1 };
    },
  };
  return a;
}

describe("extractJson", () => {
  it("parses plain, fenced and noisy JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":3} hope that helps')).toEqual({ a: 3 });
    expect(() => extractJson("nope")).toThrow();
  });
});

describe("createLlmClient", () => {
  it("returns validated data and logs tokens/latency", async () => {
    const logs: LlmLog[] = [];
    const c = createLlmClient({ adapters: [adapter("groq", async () => '{"ok":true}')], onLog: (l) => void logs.push(l) });
    const r = await c.json(call);
    expect(r.data).toEqual({ ok: true });
    expect(r.provider).toBe("groq");
    expect(logs).toEqual([expect.objectContaining({ provider: "groq", tokensIn: 10, tokensOut: 5, ok: true, step: "t" })]);
  });

  it("re-asks once with the validation error when JSON is invalid", async () => {
    const replies = ['{"ok":"yes"}', '{"ok":true}'];
    const prompts: string[] = [];
    const a = adapter("groq", async () => replies.shift()!);
    const orig = a.chat.bind(a);
    a.chat = async (req) => {
      prompts.push(req.user);
      return orig(req);
    };
    const events: LlmEvent[] = [];
    const c = createLlmClient({ adapters: [a], onEvent: (e) => void events.push(e) });
    const r = await c.json(call);
    expect(r.data.ok).toBe(true);
    expect(a.calls).toBe(2);
    expect(prompts[1]).toContain("previous reply was invalid");
    expect(prompts[1]).toContain("ok:");
    expect(events.some((e) => e.type === "reask")).toBe(true);
  });

  it("falls back to the next provider if output stays invalid", async () => {
    const bad = adapter("groq", async () => "garbage");
    const good = adapter("gemini", async () => '{"ok":true}');
    const c = createLlmClient({ adapters: [bad, good] });
    const r = await c.json(call);
    expect(r.provider).toBe("gemini");
    expect(bad.calls).toBe(2);
  });

  it("retries rate limits with exponential backoff, then succeeds", async () => {
    let n = 0;
    const a = adapter("groq", async () => {
      if (n++ < 2) throw new LlmProviderError("groq", "rate_limit", "429");
      return '{"ok":true}';
    });
    const sleeps: number[] = [];
    const events: LlmEvent[] = [];
    const c = createLlmClient({ adapters: [a], baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms), onEvent: (e) => void events.push(e) });
    const r = await c.json(call);
    expect(r.data.ok).toBe(true);
    expect(sleeps).toEqual([100, 200]);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(2);
  });

  it("falls back to Gemini when Groq keeps rate limiting", async () => {
    const groq = adapter("groq", async () => {
      throw new LlmProviderError("groq", "rate_limit", "429");
    });
    const gemini = adapter("gemini", async () => '{"ok":true}');
    const events: LlmEvent[] = [];
    const c = createLlmClient({ adapters: [groq, gemini], sleep: async () => {}, onEvent: (e) => void events.push(e) });
    const r = await c.json(call);
    expect(r.provider).toBe("gemini");
    expect(groq.calls).toBe(3); // 1 + 2 retries
    expect(events).toContainEqual(expect.objectContaining({ type: "fallback", from: "groq", to: "gemini" }));
  });

  it("does not wait for long rate-limit windows (daily quota): falls back at once", async () => {
    const groq = adapter("groq", async () => {
      throw new LlmProviderError("groq", "rate_limit", "429 daily", 429, 3_600_000);
    });
    const gemini = adapter("gemini", async () => '{"ok":true}');
    const sleep = vi.fn(async () => {});
    const c = createLlmClient({ adapters: [groq, gemini], sleep });
    const r = await c.json(call);
    expect(r.provider).toBe("gemini");
    expect(groq.calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("forced Groq failure routes to Gemini (LLM_FORCE_FAIL)", async () => {
    const groq = adapter("groq", async () => '{"ok":true}');
    const gemini = adapter("gemini", async () => '{"ok":true}');
    const c = createLlmClient({ adapters: [groq, gemini], forceFail: ["groq"] });
    const r = await c.json(call);
    expect(r.provider).toBe("gemini");
    expect(groq.calls).toBe(0);
  });

  it("skips unconfigured providers and throws a clear error if all fail", async () => {
    const a: LlmAdapter = { name: "groq", isConfigured: () => false, chat: async () => { throw new Error("x"); } };
    const c = createLlmClient({ adapters: [a] });
    await expect(c.json(call)).rejects.toThrow(/All providers failed/);
  });

  it("does not retry auth errors", async () => {
    const groq = adapter("groq", async () => {
      throw new LlmProviderError("groq", "auth", "401");
    });
    const gemini = adapter("gemini", async () => '{"ok":true}');
    const c = createLlmClient({ adapters: [groq, gemini], sleep: async () => {} });
    await c.json(call);
    expect(groq.calls).toBe(1);
  });
});

describe("HTTP adapters", () => {
  it("groq adapter maps responses, usage and rate limits", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }), { status: 200 }));
    const g = createGroqAdapter({ fetchImpl: ok as never, apiKey: "k", model: "m" });
    const r = await g.chat({ task: "other", system: "s", user: "u", maxTokens: 10, temperature: 0 });
    expect(r).toMatchObject({ text: '{"ok":true}', tokensIn: 7, tokensOut: 3, provider: "groq", model: "m" });
    const body = JSON.parse((ok.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });

    const limited = createGroqAdapter({
      fetchImpl: (async () => new Response("slow down", { status: 429, headers: { "retry-after": "2" } })) as never,
      apiKey: "k",
    });
    await expect(limited.chat({ task: "other", system: "", user: "", maxTokens: 1, temperature: 0 })).rejects.toMatchObject({ kind: "rate_limit", retryAfterMs: 2000 });
  });

  it("gemini adapter maps candidates and usage and sends the key as a header", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 } }), { status: 200 }));
    const g = createGeminiAdapter({ fetchImpl: f as never, apiKey: "secret", model: "gm" });
    const r = await g.chat({ task: "other", system: "s", user: "u", maxTokens: 10, temperature: 0 });
    expect(r).toMatchObject({ tokensIn: 9, tokensOut: 4, provider: "gemini", model: "gm" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("secret");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret");
  });

  it("adapters report unconfigured when no key", async () => {
    const g = createGroqAdapter({ apiKey: "" , fetchImpl: fetch });
    // explicit empty key falls back to env (unset in tests)
    expect(g.isConfigured()).toBe(Boolean(process.env.GROQ_API_KEY));
  });
});

describe("mock adapter", () => {
  it("classifies obvious cases and never invents quotes", async () => {
    const turns = [
      { idx: 0, speaker: "Q", role: "interviewer", text: "How do you track stock?" },
      { idx: 1, speaker: "B", role: "interviewee", text: "We write everything in a notebook every night. That is a great idea you have, I would definitely pay for it." },
    ];
    const r = await createMockAdapter().chat({ task: "classify", system: "", user: "", maxTokens: 1, temperature: 0, payload: { turns } });
    const out = JSON.parse(r.text);
    const types = out.statements.map((s: { type: string }) => s.type);
    expect(types).toContain("past_behavior");
    expect(types).toContain("compliment");
    for (const s of out.statements) expect(turns[1].text).toContain(s.quote);
  });
});

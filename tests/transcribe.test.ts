import { describe, expect, it, vi } from "vitest";
import { transcribeWithGemini, transcribeWithGroq } from "@/lib/llm/transcribe";

describe("transcription adapters (HTTP shape; no real audio is sent)", () => {
  it("Groq Whisper: multipart upload with model + verbose_json, returns text and duration", async () => {
    process.env.GROQ_API_KEY = "k";
    const { config } = await import("@/lib/config");
    config.groq.apiKey = "k";
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get("model")).toBe(config.groq.whisperModel);
      expect(form.get("response_format")).toBe("verbose_json");
      expect((form.get("file") as File).name).toBe("a.mp3");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
      return new Response(JSON.stringify({ text: " hello world ", duration: 12.5 }), { status: 200 });
    });
    const r = await transcribeWithGroq(new Blob(["x"]), "a.mp3", f as never);
    expect(r).toMatchObject({ text: "hello world", provider: "groq", durationSec: 12.5 });
  });

  it("Groq Whisper: maps rate limits to a typed error", async () => {
    const { config } = await import("@/lib/config");
    config.groq.apiKey = "k";
    const f = async () => new Response("slow down", { status: 429, headers: { "retry-after": "3" } });
    await expect(transcribeWithGroq(new Blob(["x"]), "a.mp3", f as never)).rejects.toMatchObject({ kind: "rate_limit", retryAfterMs: 3000 });
  });

  it("Gemini fallback: inline audio, key in header", async () => {
    const { config } = await import("@/lib/config");
    config.gemini.apiKey = "gk";
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).not.toContain("gk");
      const body = JSON.parse(init.body as string);
      expect(body.contents[0].parts[1].inlineData.mimeType).toBe("audio/mpeg");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Speaker 1: hi" }] } }] }), { status: 200 });
    });
    const r = await transcribeWithGemini(new Blob(["x"]), "audio/mpeg", f as never);
    expect(r.text).toBe("Speaker 1: hi");
  });
});

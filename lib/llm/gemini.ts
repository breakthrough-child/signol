import { config } from "@/lib/config";
import { classifyHttpError, describeNetworkError, parseRetryAfter } from "./groq";
import { LlmProviderError, type LlmAdapter, type LlmRequest, type LlmResponse } from "./types";

export function createGeminiAdapter(opts?: {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
}): LlmAdapter {
  const f = opts?.fetchImpl ?? fetch;
  return {
    name: "gemini",
    isConfigured: () => Boolean(opts?.apiKey ?? config.gemini.apiKey),
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const apiKey = opts?.apiKey ?? config.gemini.apiKey;
      const model = opts?.model ?? config.gemini.model;
      if (!apiKey) throw new LlmProviderError("gemini", "unconfigured", "GEMINI_API_KEY is not set");
      const started = Date.now();
      let res: Response;
      try {
        res = await f(`${config.gemini.baseUrl}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: "user", parts: [{ text: req.user }] }],
            generationConfig: {
              temperature: req.temperature,
              maxOutputTokens: req.maxTokens,
              responseMimeType: "application/json",
            },
          }),
        });
      } catch (e) {
        throw new LlmProviderError("gemini", "network", `Network error: ${describeNetworkError(e)}`);
      }
      if (!res.ok) {
        throw classifyHttpError("gemini", res.status, await res.text(), parseRetryAfter(res.headers.get("retry-after")));
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      return {
        text,
        provider: "gemini",
        model,
        tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - started,
      };
    },
  };
}

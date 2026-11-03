import { config } from "@/lib/config";
import { LlmProviderError, type LlmAdapter, type LlmRequest, type LlmResponse } from "./types";

export function describeNetworkError(e: unknown): string {
  const err = e as Error & { cause?: { message?: string; code?: string } };
  const cause = err.cause ? ` (${err.cause.code ?? ""} ${err.cause.message ?? String(err.cause)})`.replace("( ", "(") : "";
  return `${err.message}${cause}`;
}

export function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (!Number.isNaN(s)) return Math.round(s * 1000);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
}

export function classifyHttpError(provider: string, status: number, body: string, retryAfter?: number) {
  const short = body.slice(0, 300);
  if (status === 429) return new LlmProviderError(provider, "rate_limit", `Rate limited: ${short}`, status, retryAfter);
  if (status === 413) return new LlmProviderError(provider, "too_large", `Request too large: ${short}`, status);
  if (status === 401 || status === 403) return new LlmProviderError(provider, "auth", `Auth error: ${short}`, status);
  if (status >= 500) return new LlmProviderError(provider, "server", `Server error ${status}: ${short}`, status, retryAfter);
  return new LlmProviderError(provider, "bad_request", `HTTP ${status}: ${short}`, status);
}

export function createGroqAdapter(opts?: {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
}): LlmAdapter {
  const f = opts?.fetchImpl ?? fetch;
  return {
    name: "groq",
    isConfigured: () => Boolean(opts?.apiKey ?? config.groq.apiKey),
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const apiKey = opts?.apiKey ?? config.groq.apiKey;
      const model = opts?.model ?? config.groq.chatModel;
      if (!apiKey) throw new LlmProviderError("groq", "unconfigured", "GROQ_API_KEY is not set");
      const started = Date.now();
      let res: Response;
      try {
        res = await f(`${config.groq.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          }),
        });
      } catch (e) {
        throw new LlmProviderError("groq", "network", `Network error: ${describeNetworkError(e)}`);
      }
      if (!res.ok) {
        throw classifyHttpError("groq", res.status, await res.text(), parseRetryAfter(res.headers.get("retry-after")));
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      return {
        text,
        provider: "groq",
        model,
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - started,
      };
    },
  };
}

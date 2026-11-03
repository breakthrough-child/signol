import { config } from "@/lib/config";
import { classifyHttpError, describeNetworkError, parseRetryAfter } from "./groq";
import { LlmProviderError } from "./types";

export interface TranscribeResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  durationSec?: number;
}

const GEMINI_AUDIO_PROMPT =
  "Transcribe this interview audio verbatim. Put each speaker turn on its own line as 'Speaker 1: ...' / 'Speaker 2: ...'. Do not summarise, translate or add commentary.";

/** Groq Whisper (primary). */
export async function transcribeWithGroq(file: Blob, filename: string, fetchImpl: typeof fetch = fetch): Promise<TranscribeResult> {
  if (!config.groq.apiKey) throw new LlmProviderError("groq", "unconfigured", "GROQ_API_KEY is not set");
  const started = Date.now();
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", config.groq.whisperModel);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  let res: Response;
  try {
    res = await fetchImpl(`${config.groq.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.groq.apiKey}` },
      body: form,
    });
  } catch (e) {
    throw new LlmProviderError("groq", "network", `Network error: ${describeNetworkError(e)}`);
  }
  if (!res.ok) throw classifyHttpError("groq", res.status, await res.text(), parseRetryAfter(res.headers.get("retry-after")));
  const json = (await res.json()) as { text?: string; duration?: number };
  return {
    text: (json.text ?? "").trim(),
    provider: "groq",
    model: config.groq.whisperModel,
    latencyMs: Date.now() - started,
    durationSec: json.duration,
  };
}

/** Gemini (fallback): inline audio, suitable for the small files allowed by the upload limit. */
export async function transcribeWithGemini(file: Blob, mime: string, fetchImpl: typeof fetch = fetch): Promise<TranscribeResult> {
  if (!config.gemini.apiKey) throw new LlmProviderError("gemini", "unconfigured", "GEMINI_API_KEY is not set");
  const started = Date.now();
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  let res: Response;
  try {
    res = await fetchImpl(`${config.gemini.baseUrl}/models/${config.gemini.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.gemini.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: GEMINI_AUDIO_PROMPT }, { inlineData: { mimeType: mime, data: b64 } }] }],
        generationConfig: { temperature: 0 },
      }),
    });
  } catch (e) {
    throw new LlmProviderError("gemini", "network", `Network error: ${describeNetworkError(e)}`);
  }
  if (!res.ok) throw classifyHttpError("gemini", res.status, await res.text(), parseRetryAfter(res.headers.get("retry-after")));
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  return { text, provider: "gemini", model: config.gemini.model, latencyMs: Date.now() - started };
}

/** Whisper first, Gemini as fallback. Throws the last error if both fail. */
export async function transcribeAudio(file: Blob, filename: string, mime: string): Promise<TranscribeResult> {
  const errors: Error[] = [];
  if (!config.forceFail.includes("groq")) {
    try {
      return await transcribeWithGroq(file, filename);
    } catch (e) {
      errors.push(e as Error);
    }
  }
  try {
    return await transcribeWithGemini(file, mime);
  } catch (e) {
    errors.push(e as Error);
  }
  throw new Error(errors.map((e) => e.message).join(" | "));
}

/**
 * Central runtime configuration. Model IDs live here (read from env) rather than
 * being hardcoded in adapters, because free-tier model catalogues change often.
 */
export const config = {
  providerOrder: (process.env.LLM_PROVIDER_ORDER ?? "groq,gemini")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? "",
    chatModel: process.env.GROQ_CHAT_MODEL ?? "llama-3.3-70b-versatile",
    whisperModel: process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo",
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    baseUrl:
      process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
  },
  limits: {
    maxInterviews: 15,
    maxFileMb: 25,
    maxTextChars: 60_000,
    /** Max words of transcript sent to the model in a single classify call. */
    chunkWords: 900,
  },
  /** Force the failure of a provider, used to test fallback (comma separated names). */
  forceFail: (process.env.LLM_FORCE_FAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export type ProviderName = "groq" | "gemini" | "mock";

export function isMockEnabled(): boolean {
  return config.providerOrder.includes("mock");
}

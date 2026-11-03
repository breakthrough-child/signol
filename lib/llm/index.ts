import { config } from "@/lib/config";
import { createLlmClient, type LlmClient, type LlmClientOptions } from "./client";
import { createGeminiAdapter } from "./gemini";
import { createGroqAdapter } from "./groq";
import { createMockAdapter } from "./mock";
import type { LlmAdapter } from "./types";

export * from "./types";
export { createLlmClient, extractJson } from "./client";

export function defaultAdapters(): LlmAdapter[] {
  const all: Record<string, LlmAdapter> = {
    groq: createGroqAdapter(),
    gemini: createGeminiAdapter(),
    mock: createMockAdapter(),
  };
  return config.providerOrder.map((n) => all[n]).filter(Boolean);
}

export function getLlm(hooks?: Pick<LlmClientOptions, "onEvent" | "onLog">): LlmClient {
  return createLlmClient({
    adapters: defaultAdapters(),
    forceFail: config.forceFail,
    ...hooks,
  });
}

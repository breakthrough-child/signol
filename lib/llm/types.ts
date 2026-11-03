import type { ZodType } from "zod";

export type LlmTask = "classify" | "leading" | "synthesize" | "script" | "other";

export interface LlmRequest {
  task: LlmTask;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /** Structured input, only consumed by the offline mock adapter. Never sent to real providers. */
  payload?: unknown;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface LlmAdapter {
  name: string;
  isConfigured(): boolean;
  chat(req: LlmRequest): Promise<LlmResponse>;
}

export type ProviderErrorKind =
  | "rate_limit"
  | "too_large"
  | "server"
  | "auth"
  | "bad_request"
  | "network"
  | "unconfigured"
  | "forced";

export class LlmProviderError extends Error {
  constructor(
    public provider: string,
    public kind: ProviderErrorKind,
    message: string,
    public status?: number,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "server" || this.kind === "network";
  }
}

export class LlmInvalidOutputError extends Error {
  constructor(
    public provider: string,
    message: string,
  ) {
    super(message);
    this.name = "LlmInvalidOutputError";
  }
}

export class LlmAllFailedError extends Error {
  constructor(
    message: string,
    public causes: Error[],
  ) {
    super(message);
    this.name = "LlmAllFailedError";
  }
}

export type LlmEvent =
  | { type: "retry"; provider: string; inMs: number; reason: string }
  | { type: "fallback"; from: string; to: string | null; reason: string }
  | { type: "reask"; provider: string; reason: string };

export interface LlmLog {
  step: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export interface JsonCallOptions<T> {
  step: string;
  task: LlmTask;
  system: string;
  user: string;
  schema: ZodType<T>;
  payload?: unknown;
  maxTokens?: number;
  temperature?: number;
}

export interface JsonCallResult<T> {
  data: T;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

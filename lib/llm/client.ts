import { sleep } from "@/lib/utils";
import {
  LlmAllFailedError,
  LlmInvalidOutputError,
  LlmProviderError,
  type JsonCallOptions,
  type JsonCallResult,
  type LlmAdapter,
  type LlmEvent,
  type LlmLog,
  type LlmRequest,
  type LlmResponse,
} from "./types";

export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("No JSON object found in model output");
}

export interface LlmClientOptions {
  adapters: LlmAdapter[];
  /** Providers that should fail on purpose (to test fallback). */
  forceFail?: string[];
  maxRetries?: number;
  baseDelayMs?: number;
  /** Do not wait longer than this for a rate limit; fall back instead. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (e: LlmEvent) => void | Promise<void>;
  onLog?: (l: LlmLog) => void | Promise<void>;
}

export interface LlmClient {
  json<T>(opts: JsonCallOptions<T>): Promise<JsonCallResult<T>>;
}

export function createLlmClient(options: LlmClientOptions): LlmClient {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelay = options.baseDelayMs ?? 800;
  const maxWait = options.maxWaitMs ?? 15_000;
  const wait = options.sleep ?? sleep;
  const emit = async (e: LlmEvent) => {
    await options.onEvent?.(e);
  };
  const log = async (l: LlmLog) => {
    await options.onLog?.(l);
  };

  async function callWithRetry(adapter: LlmAdapter, req: LlmRequest, step: string): Promise<LlmResponse> {
    let attempt = 0;
    for (;;) {
      try {
        if (options.forceFail?.includes(adapter.name)) {
          throw new LlmProviderError(adapter.name, "forced", "Forced failure (LLM_FORCE_FAIL)");
        }
        if (!adapter.isConfigured()) {
          throw new LlmProviderError(adapter.name, "unconfigured", `${adapter.name} is not configured`);
        }
        const res = await adapter.chat(req);
        await log({ step, provider: res.provider, model: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, latencyMs: res.latencyMs, ok: true });
        return res;
      } catch (err) {
        const e = err as LlmProviderError;
        const isProv = e instanceof LlmProviderError;
        if (isProv && e.kind !== "unconfigured" && e.kind !== "forced") {
          await log({ step, provider: adapter.name, model: "", tokensIn: 0, tokensOut: 0, latencyMs: 0, ok: false, error: e.message });
        }
        if (!isProv || !e.retryable || attempt >= maxRetries) throw err;
        const delay = e.retryAfterMs ?? baseDelay * 2 ** attempt;
        if (delay > maxWait) throw err; // e.g. daily quota: do not sit and wait
        await emit({ type: "retry", provider: adapter.name, inMs: delay, reason: e.message });
        await wait(delay);
        attempt++;
      }
    }
  }

  return {
    async json<T>(opts: JsonCallOptions<T>): Promise<JsonCallResult<T>> {
      const base: LlmRequest = {
        task: opts.task,
        system: opts.system,
        user: opts.user,
        maxTokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.1,
        payload: opts.payload,
      };
      const causes: Error[] = [];
      const adapters = options.adapters;
      for (let ai = 0; ai < adapters.length; ai++) {
        const adapter = adapters[ai];
        try {
          let res = await callWithRetry(adapter, base, opts.step);
          let parsed = tryParse(opts, res.text);
          if (!parsed.ok) {
            await emit({ type: "reask", provider: adapter.name, reason: parsed.error });
            const retryReq: LlmRequest = {
              ...base,
              user: `${base.user}\n\nYour previous reply was invalid: ${parsed.error}\nReply again with ONLY a single valid JSON object that matches the requested schema exactly.`,
            };
            res = await callWithRetry(adapter, retryReq, `${opts.step}:reask`);
            parsed = tryParse(opts, res.text);
            if (!parsed.ok) throw new LlmInvalidOutputError(adapter.name, parsed.error);
          }
          return {
            data: parsed.data,
            provider: res.provider,
            model: res.model,
            tokensIn: res.tokensIn,
            tokensOut: res.tokensOut,
            latencyMs: res.latencyMs,
          };
        } catch (err) {
          const e = err as Error;
          causes.push(e);
          const next = adapters[ai + 1]?.name ?? null;
          const quiet = e instanceof LlmProviderError && (e.kind === "unconfigured" || e.kind === "forced");
          if (next || !quiet) await emit({ type: "fallback", from: adapter.name, to: next, reason: e.message });
        }
      }
      throw new LlmAllFailedError(
        `All providers failed: ${causes.map((c) => c.message).join(" | ")}`,
        causes,
      );
    },
  };
}

function tryParse<T>(
  opts: JsonCallOptions<T>,
  text: string,
): { ok: true; data: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON (${(e as Error).message})` };
  }
  const r = opts.schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const msg = r.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `schema validation failed: ${msg}` };
}

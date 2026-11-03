import { NextResponse } from "next/server";
import { HttpError } from "@/lib/supabase/server";
import { LlmAllFailedError } from "@/lib/llm/types";

export function ok(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function fail(status: number, message: string, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Wraps a route handler: converts thrown HttpErrors / provider failures into friendly JSON. */
export function handle<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message, e.code);
      if (e instanceof LlmAllFailedError) {
        return fail(
          503,
          "The AI providers are busy or unavailable right now. Your progress is saved; try again in a minute, or use the cached demo analysis.",
          "llm_unavailable",
        );
      }
      console.error(e);
      return fail(500, e instanceof Error ? e.message : "Unexpected error", "internal");
    }
  };
}

export type IdCtx = { params: Promise<{ id: string }> };
export type IdIidCtx = { params: Promise<{ id: string; iid: string }> };

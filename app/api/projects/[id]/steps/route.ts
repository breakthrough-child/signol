import { z } from "zod";
import { fail, handle, ok, type IdCtx } from "@/lib/api";
import type { PipelineStepRow } from "@/lib/db-types";
import { LlmAllFailedError, LlmInvalidOutputError, LlmProviderError } from "@/lib/llm/types";
import { makeCtx } from "@/lib/pipeline/context";
import { friendlyStepError, runStep } from "@/lib/pipeline/run";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

const input = z.object({ step_key: z.string().min(1).max(100) });

export function describeFailure(step: PipelineStepRow["step"], e: unknown): string {
  if (e instanceof LlmAllFailedError) {
    const causes = e.causes;
    if (causes.every((c) => c instanceof LlmProviderError && (c.kind === "unconfigured" || c.kind === "forced"))) {
      return "No AI provider is available. Add GROQ_API_KEY (and optionally GEMINI_API_KEY) to the server environment.";
    }
    if (causes.some((c) => c instanceof LlmInvalidOutputError)) {
      return "The model returned malformed output twice, even after a retry. Press Retry; if it keeps happening, use the cached demo analysis.";
    }
    if (causes.some((c) => c instanceof LlmProviderError && (c.kind === "rate_limit" || c.kind === "too_large"))) {
      return "The free AI tiers are rate limited right now. Your progress is saved. Wait a minute and press Retry.";
    }
    return "The AI providers could not be reached. Your progress is saved. Press Retry in a moment.";
  }
  return friendlyStepError(step, e);
}

/** Runs ONE pipeline step. The client calls this in plan order; each step is stored so a failed run resumes. */
export const POST = handle(async (req: Request, routeCtx: IdCtx) => {
  const { id } = await routeCtx.params;
  const { supabase, user } = await requireUser();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Missing step.");
  const pctx = await makeCtx(supabase, user.id, id);

  const found = await supabase.from("pipeline_steps").select("*").eq("project_id", id).eq("step_key", parsed.data.step_key).maybeSingle();
  const row = found.data as PipelineStepRow | null;
  if (!row) return fail(404, "Unknown step. Start the analysis first.");
  if (row.status === "done") return ok({ step: row, complete: await isComplete(supabase, id) });
  if (row.status === "running" && Date.now() - Date.parse(row.updated_at) < 90_000) return ok({ step: row, complete: false });

  await supabase.from("pipeline_steps").update({ status: "running", error: null, note: null, attempts: row.attempts + 1, updated_at: new Date().toISOString() }).eq("id", row.id);

  let result: { status: PipelineStepRow["status"]; note: string | null; error: string | null };
  try {
    const r = await runStep(pctx, row);
    result = { status: r.status, note: r.note, error: null };
  } catch (e) {
    result = { status: "error", note: null, error: describeFailure(row.step, e) };
    if (!(e instanceof LlmAllFailedError)) console.error("step failed", row.step_key, e);
  }
  const upd = await supabase.from("pipeline_steps").update({ ...result, updated_at: new Date().toISOString() }).eq("id", row.id).select().single();

  const complete = result.status === "done" && (await isComplete(supabase, id));
  if (complete) await finalize(supabase, id);
  return ok({ step: upd.data, complete });
});

async function isComplete(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], projectId: string) {
  const r = await supabase.from("pipeline_steps").select("status").eq("project_id", projectId);
  const rows = (r.data ?? []) as { status: string }[];
  return rows.length > 0 && rows.every((s) => s.status === "done");
}

async function finalize(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], projectId: string) {
  const p = await supabase.from("projects").select("status").eq("id", projectId).single();
  if ((p.data as { status: string } | null)?.status === "analyzed" || (p.data as { status: string } | null)?.status === "decided") return;
  await supabase.from("projects").update({ status: "analyzed", analysis_source: "live" }).eq("id", projectId);
  await supabase.from("timing_events").insert({ project_id: projectId, event: "analysis_finished", meta: { mode: "live" } });
}

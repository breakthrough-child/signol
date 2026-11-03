import { z } from "zod";
import { fail, handle, ok, type IdCtx } from "@/lib/api";
import { loadCachedAnalysis } from "@/lib/pipeline/cached";
import { loadProject, makeCtx } from "@/lib/pipeline/context";
import { planSteps } from "@/lib/pipeline/steps";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

const input = z.object({ mode: z.enum(["live", "cached"]).default("live") });

/**
 * Starts analysis. This is the moment Checkpoint 1 locks: hypothesis and prediction become immutable.
 * Idempotent: calling it again resumes (existing step rows are kept).
 */
export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { supabase, user } = await requireUser();
  const parsed = input.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, "Bad request");
  const project = await loadProject(supabase, id);

  if (parsed.data.mode === "cached") {
    if (!project.is_demo) return fail(400, "The cached analysis is only available for the demo project.", "not_demo");
    if (project.status === "decided") return fail(409, "This demo has already been decided. Start a fresh demo.", "decided");
    await loadCachedAnalysis(await makeCtx(supabase, user.id, id));
    return ok({ mode: "cached", status: "analyzed" });
  }

  const iv = await supabase.from("interviews").select("id,source_type,raw_text").eq("project_id", id).order("position", { ascending: true });
  const interviews = (iv.data ?? []) as { id: string; source_type: string; raw_text: string | null }[];
  if (!interviews.length) return fail(400, "Add at least one interview before analysing.", "no_interviews");

  if (!project.locked_at) {
    const { error } = await supabase.from("projects").update({ locked_at: new Date().toISOString(), status: "analyzing" }).eq("id", id);
    if (error) return fail(400, error.message);
  } else if (project.status === "locked") {
    await supabase.from("projects").update({ status: "analyzing" }).eq("id", id);
  }

  const plan = planSteps(interviews).map((p) => ({ project_id: id, ...p, status: "pending" }));
  const { error } = await supabase.from("pipeline_steps").upsert(plan, { onConflict: "project_id,step_key", ignoreDuplicates: true });
  if (error) return fail(400, error.message);

  const started = await supabase.from("timing_events").select("id").eq("project_id", id).eq("event", "analysis_started").limit(1);
  if (!started.data?.length) await supabase.from("timing_events").insert({ project_id: id, event: "analysis_started", meta: { mode: "live" } });

  const steps = await supabase.from("pipeline_steps").select("*").eq("project_id", id);
  return ok({ mode: "live", steps: steps.data ?? [] });
});

import { demoSeed } from "@/lib/demo";
import type { InterviewRow } from "@/lib/db-types";
import { PROMPT_VERSIONS } from "@/lib/prompts";
import { statementWeight } from "@/lib/scoring";
import type { PipelineCtx } from "./context";
import { planSteps } from "./steps";
import { normalizeInterview, scoreProject, verifyInterview } from "./run";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/**
 * Load the cached demo analysis. It is *not* trusted blindly: statements are inserted unverified
 * and the same code-level quote verification used for live runs decides what is shown as verified.
 * The result is clearly labelled `analysis_source = 'cached'` everywhere in the UI and exports.
 */
export async function loadCachedAnalysis(ctx: PipelineCtx) {
  const { supabase, project } = ctx;
  const ivRes = await supabase.from("interviews").select("*").eq("project_id", project.id).order("position", { ascending: true });
  const interviews = must(ivRes, "load interviews") as InterviewRow[];
  if (interviews.length !== demoSeed.interviews.length) throw new Error("The cached analysis only applies to the unmodified demo interviews.");
  const texts = interviews.map((i) => (i.raw_text ?? "").trim());
  if (texts.some((t, i) => t !== demoSeed.interviews[i].text.trim())) throw new Error("The cached analysis only applies to the unmodified demo interviews.");

  const now = new Date().toISOString();
  if (!project.locked_at) must(await supabase.from("projects").update({ locked_at: now, status: "analyzing" }).eq("id", project.id).select("id"), "lock project");
  must(await supabase.from("timing_events").insert({ project_id: project.id, event: "analysis_started", meta: { mode: "cached" } }).select("id"), "timing");

  for (const t of ["statements", "leading_questions", "syntheses", "pipeline_steps"]) {
    must(await supabase.from(t).delete().eq("project_id", project.id).select("id"), `reset ${t}`);
  }

  // Split transcripts into turns with the same code path as live runs.
  for (const iv of interviews) await normalizeInterview(ctx, iv);

  const idOf = interviews.map((i) => i.id);
  const stRows = demoSeed.cached.statements.map((s) => ({
    project_id: project.id,
    interview_id: idOf[s.interview],
    turn_idx: s.turn_idx,
    type: s.type,
    stance: s.stance,
    quote: s.quote,
    rationale: s.rationale,
    verified: false,
    tainted: false,
    weight: statementWeight(s.type, false),
  }));
  const inserted = must(await supabase.from("statements").insert(stRows).select("id"), "save statements") as { id: string }[];
  const lqRows = demoSeed.cached.leading.map((q) => ({
    project_id: project.id,
    interview_id: idOf[q.interview],
    turn_idx: q.turn_idx,
    question: q.question,
    why_leading: q.why_leading,
    neutral_rewrite: q.neutral_rewrite,
    tainted_turn_idxs: q.tainted_turn_idxs,
    verified: false,
  }));
  if (lqRows.length) must(await supabase.from("leading_questions").insert(lqRows).select("id"), "save leading questions");

  // Real verification (code), per interview. This is what sets the "quotes verified" badge.
  for (const id of idOf) await verifyInterview(ctx, id);

  // Statement ids are assigned by the database, in insertion order == cached order.
  const idByKey = new Map(demoSeed.cached.statements.map((s, i) => [s.key, inserted[i].id]));
  const syn = demoSeed.cached.synthesis;
  const sc = await scoreProject(ctx);
  must(
    await supabase
      .from("syntheses")
      .upsert(
        {
          project_id: project.id,
          themes: syn.themes.map((t) => ({ title: t.title, summary: t.summary, statement_ids: t.keys.map((k) => idByKey.get(k)).filter(Boolean) })),
          top_for: syn.top_for.map((p) => ({ statement_id: idByKey.get(p.key), why: p.why })).filter((p) => p.statement_id),
          top_against: syn.top_against.map((p) => ({ statement_id: idByKey.get(p.key), why: p.why })).filter((p) => p.statement_id),
          open_questions: syn.open_questions,
          score: sc,
          prompt_versions: { ...PROMPT_VERSIONS, source: "cached-demo" },
        },
        { onConflict: "project_id" },
      )
      .select("id"),
    "save synthesis",
  );

  // Mark every pipeline step done so the UI shows a complete run.
  const plan = planSteps(interviews).map((p) => ({ project_id: project.id, ...p, status: "done", note: "Loaded from cached analysis", attempts: 0 }));
  must(await supabase.from("pipeline_steps").insert(plan).select("id"), "save steps");
  must(await supabase.from("run_logs").insert({ project_id: project.id, step: "cached_analysis", provider: "cached", model: demoSeed.cached.generatedBy, tokens_in: 0, tokens_out: 0, latency_ms: 0, ok: true }).select("id"), "run log");
  must(await supabase.from("projects").update({ status: "analyzed", analysis_source: "cached" }).eq("id", project.id).select("id"), "finish project");
  must(await supabase.from("timing_events").insert({ project_id: project.id, event: "analysis_finished", meta: { mode: "cached" } }).select("id"), "timing");
}

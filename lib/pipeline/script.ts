import type { LeadingQuestionRow, ScriptDoc, SynthesisRow } from "@/lib/db-types";
import { SCRIPT_SYSTEM, buildScriptUser } from "@/lib/prompts";
import type { ScoreResult } from "@/lib/scoring";
import { normalizeText } from "@/lib/text/match";
import { scriptOutputSchema } from "@/lib/types";
import type { PipelineCtx } from "./context";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export function weakAreas(score: ScoreResult): string[] {
  const out: string[] = [];
  if (score.byType.past_behavior < 3) out.push(`Only ${score.byType.past_behavior} statement(s) describe real past behavior.`);
  if (score.strongAgainst === 0) out.push("No strong counter-evidence was collected; actively look for people who would not buy.");
  if (score.positiveSounding.pctNotEvidence >= 50) out.push(`${score.positiveSounding.pctNotEvidence}% of positive feedback was compliments or promises.`);
  if (score.tainted > 0) out.push(`${score.tainted} answer(s) were tainted by leading questions and need re-asking neutrally.`);
  const weakInterviews = score.perInterview.filter((p) => p.strongFor + p.strongAgainst === 0).map((p) => p.label);
  if (weakInterviews.length) out.push(`No strong evidence from: ${weakInterviews.join(", ")}.`);
  return out;
}

function questionsOf(text: string): string[] {
  const parts = text.match(/[^.!?]*\?/g) ?? [];
  return parts.map((p) => p.trim()).filter((p) => p.split(/\s+/).length >= 5);
}

export async function buildScript(ctx: PipelineCtx, synthesis: SynthesisRow): Promise<ScriptDoc> {
  const [turnsRes, lqRes, ivRes] = await Promise.all([
    ctx.supabase.from("turns").select("interview_id,idx,role,text").eq("project_id", ctx.project.id).eq("role", "interviewer").order("idx", { ascending: true }),
    ctx.supabase.from("leading_questions").select("*").eq("project_id", ctx.project.id).eq("verified", true),
    ctx.supabase.from("interviews").select("id,label").eq("project_id", ctx.project.id),
  ]);
  const turns = must(turnsRes, "load turns") as { interview_id: string; idx: number; role: string; text: string }[];
  const lqs = must(lqRes, "load leading questions") as LeadingQuestionRow[];
  const labels = new Map((must(ivRes, "load interviews") as { id: string; label: string }[]).map((i) => [i.id, i.label]));

  const leadingNorm = lqs.map((q) => normalizeText(q.question));
  const rewritten: ScriptDoc["rewritten"] = [];
  const seenRewrite = new Set<string>();
  for (const q of lqs) {
    const key = normalizeText(q.neutral_rewrite);
    if (seenRewrite.has(key)) continue;
    seenRewrite.add(key);
    rewritten.push({ original: q.question, rewrite: q.neutral_rewrite, why: q.why_leading });
  }

  const kept: ScriptDoc["kept"] = [];
  const seen = new Set<string>();
  for (const t of turns) {
    for (const q of questionsOf(t.text)) {
      const n = normalizeText(q);
      if (seen.has(n) || leadingNorm.some((l) => l.includes(n) || n.includes(l))) continue;
      seen.add(n);
      kept.push({ question: q, source: labels.get(t.interview_id) ?? "" });
    }
  }

  const llm = ctx.llmFor("script");
  const weak = weakAreas(synthesis.score as ScoreResult);
  const res = await llm.json({
    step: "script",
    task: "script",
    system: SCRIPT_SYSTEM,
    user: buildScriptUser({ hypothesis: ctx.project.hypothesis, targetCustomer: ctx.project.target_customer, openQuestions: synthesis.open_questions, weakAreas: weak, existingQuestions: [...kept.map((k) => k.question), ...rewritten.map((r) => r.rewrite)].slice(0, 12) }),
    schema: scriptOutputSchema,
    payload: { openQuestions: synthesis.open_questions, weakAreas: weak },
    maxTokens: 1200,
  });
  return { kept: kept.slice(0, 8), rewritten: rewritten.slice(0, 8), added: res.data.new_questions, generatedAt: new Date().toISOString() };
}

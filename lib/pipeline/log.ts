import type { Calibration } from "@/lib/scoring";
import { computeCalibration, statementWeight, strengthOf } from "@/lib/scoring";
import type { DecisionLog, Choice, LogEvidence } from "@/lib/decision";
import type { InterviewRow, StatementRow, SynthesisRow, ProjectRow } from "@/lib/db-types";
import type { PipelineCtx } from "./context";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export interface BoardData {
  project: ProjectRow;
  interviews: InterviewRow[];
  statements: StatementRow[];
  synthesis: SynthesisRow;
}

export async function loadBoardData(ctx: PipelineCtx): Promise<BoardData> {
  const [iv, st, sy] = await Promise.all([
    ctx.supabase.from("interviews").select("*").eq("project_id", ctx.project.id).order("position", { ascending: true }),
    ctx.supabase.from("statements").select("*").eq("project_id", ctx.project.id),
    ctx.supabase.from("syntheses").select("*").eq("project_id", ctx.project.id).maybeSingle(),
  ]);
  const synthesis = must(sy, "load synthesis") as SynthesisRow | null;
  if (!synthesis) throw new Error("The analysis has not finished yet.");
  return {
    project: ctx.project,
    interviews: must(iv, "load interviews") as InterviewRow[],
    statements: must(st, "load statements") as StatementRow[],
    synthesis,
  };
}

export function toLogEvidence(s: StatementRow, why: string, interviewLabel: string): LogEvidence {
  return {
    id: s.id,
    quote: s.quote,
    interview: interviewLabel,
    type: s.type,
    stance: s.stance,
    strength: strengthOf(statementWeight(s.type, s.tainted)),
    tainted: s.tainted,
    why,
  };
}

export function buildDecisionLog(
  data: BoardData,
  choice: Choice,
  responses: { statement_id: string; response: string }[],
  decidedAt: string,
): { log: DecisionLog; calibration: Calibration } {
  const { project, interviews, statements, synthesis } = data;
  const label = new Map(interviews.map((i) => [i.id, i.label]));
  const byId = new Map(statements.map((s) => [s.id, s]));
  const score = synthesis.score as DecisionLog["evidence"]["score"];
  const calibration = computeCalibration(project.predicted_supporters, project.predicted_confidence, score);
  const ev = (picks: { statement_id: string; why: string }[]) =>
    picks.flatMap((p) => {
      const s = byId.get(p.statement_id);
      return s ? [toLogEvidence(s, p.why, label.get(s.interview_id) ?? "?")] : [];
    });
  const topFor = ev(synthesis.top_for);
  const topAgainst = ev(synthesis.top_against);
  const sideOf = new Map<string, "for" | "against">([...topFor.map((e) => [e.id, "for"] as const), ...topAgainst.map((e) => [e.id, "against"] as const)]);
  const log: DecisionLog = {
    version: 1,
    project: { name: project.name, hypothesis: project.hypothesis, target_customer: project.target_customer, is_demo: project.is_demo },
    prediction: { supporters: project.predicted_supporters, confidence: project.predicted_confidence, lockedAt: project.locked_at },
    analysis: {
      source: project.analysis_source ?? "live",
      interviews: interviews.length,
      quotesVerified: statements.filter((s) => s.verified).length,
      quotesTotal: statements.length,
    },
    evidence: { headline: score.headline, score },
    topFor,
    topAgainst,
    themes: synthesis.themes.map((t) => ({ title: t.title, summary: t.summary })),
    openQuestions: synthesis.open_questions,
    responses: responses.flatMap((r) => {
      const s = byId.get(r.statement_id);
      const side = sideOf.get(r.statement_id);
      return s && side ? [{ side, quote: s.quote, interview: label.get(s.interview_id) ?? "?", response: r.response.trim() }] : [];
    }),
    choice,
    calibration,
    decidedAt,
  };
  return { log, calibration };
}

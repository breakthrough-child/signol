import type { Calibration, ScoreResult } from "@/lib/scoring";
import { TYPE_LABELS, type Stance, type StatementType } from "@/lib/types";

export type Choice = "validated" | "invalidated" | "need_more_evidence";

export const CHOICE_LABELS: Record<Choice, string> = {
  validated: "Validated",
  invalidated: "Invalidated",
  need_more_evidence: "Need more evidence",
};

export interface LogEvidence {
  id: string;
  quote: string;
  interview: string;
  type: StatementType;
  stance: Stance;
  strength: string;
  tainted: boolean;
  why: string;
}

export interface DecisionLog {
  version: 1;
  project: { name: string; hypothesis: string; target_customer: string; is_demo: boolean };
  prediction: { supporters: number; confidence: number; lockedAt: string | null };
  analysis: { source: "live" | "cached"; interviews: number; quotesVerified: number; quotesTotal: number };
  evidence: { headline: string; score: ScoreResult };
  topFor: LogEvidence[];
  topAgainst: LogEvidence[];
  themes: { title: string; summary: string }[];
  openQuestions: string[];
  responses: { side: "for" | "against"; quote: string; interview: string; response: string }[];
  choice: Choice;
  calibration: Calibration;
  decidedAt: string;
}

export interface FrictionResult {
  ok: boolean;
  /** Statement ids that still need a written response. */
  missing: string[];
  required: string[];
  message?: string;
}

export const MIN_RESPONSE_WORDS = 3;

export function isRealResponse(text: string | undefined): boolean {
  if (!text) return false;
  const words = text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length >= MIN_RESPONSE_WORDS;
}

/**
 * Friction by design (enforced on the server as well as in the UI):
 *  - validated   -> respond to each of the top counter-evidence cards
 *  - invalidated -> respond to each of the top supporting cards
 *  - need_more_evidence -> no friction
 */
export function checkFriction(
  choice: Choice,
  topFor: string[],
  topAgainst: string[],
  responses: { statement_id: string; response: string }[],
): FrictionResult {
  const required = choice === "validated" ? topAgainst : choice === "invalidated" ? topFor : [];
  const have = new Map(responses.map((r) => [r.statement_id, r.response]));
  const missing = required.filter((id) => !isRealResponse(have.get(id)));
  return {
    ok: missing.length === 0,
    missing,
    required,
    message: missing.length
      ? `Write a short response (at least one sentence) to each of the ${required.length} ${choice === "validated" ? "counter-evidence" : "supporting"} cards before choosing ${CHOICE_LABELS[choice]}.`
      : undefined,
  };
}

/* ------------------------------------------------------------------ markdown export */

const fmtDate = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function decisionLogToMarkdown(log: DecisionLog): string {
  const L: string[] = [];
  const ev = (e: LogEvidence) =>
    `- “${e.quote}” — ${e.interview} · ${TYPE_LABELS[e.type]} · ${e.strength}${e.tainted ? " · tainted by a leading question" : ""}\n  - Why it matters: ${e.why}`;
  L.push(`# Decision log: ${log.project.name}`, "");
  L.push(`**Decision:** ${CHOICE_LABELS[log.choice]} · ${fmtDate(log.decidedAt)}`, "");
  L.push(`## Hypothesis`, "", log.project.hypothesis, "", `**Target customer:** ${log.project.target_customer}`, "");
  L.push(`## Pre-committed prediction (Checkpoint 1)`, "");
  L.push(`Before any analysis you predicted **${log.prediction.supporters} of ${log.analysis.interviews}** interviewees would support the hypothesis, with **${log.prediction.confidence}%** confidence${log.prediction.lockedAt ? ` (locked ${fmtDate(log.prediction.lockedAt)})` : ""}.`, "");
  L.push(`## What the evidence shows`, "", `> ${log.evidence.headline}`, "");
  const s = log.evidence.score;
  L.push(`- Verified statements: ${s.verifiedCount} (${log.analysis.quotesVerified}/${log.analysis.quotesTotal} quotes verified against transcripts)`);
  L.push(`- Strong evidence: ${s.strongFor} for · ${s.strongAgainst} against`);
  L.push(`- Answers tainted by leading questions: ${s.tainted}`);
  L.push(`- Interviewees with strong supporting evidence: ${s.supporters} of ${s.interviewCount}`);
  if (log.analysis.source === "cached") L.push(`- Analysis source: cached demo analysis (not a live model run)`);
  L.push("", `### Strongest evidence for`, "", log.topFor.length ? log.topFor.map(ev).join("\n") : "_None found._", "");
  L.push(`### Strongest evidence against`, "", log.topAgainst.length ? log.topAgainst.map(ev).join("\n") : "_None found._", "");
  if (log.themes.length) {
    L.push(`### Themes`, "", ...log.themes.map((t) => `- **${t.title}:** ${t.summary}`), "");
  }
  if (log.openQuestions.length) {
    L.push(`### Open questions`, "", ...log.openQuestions.map((q) => `- ${q}`), "");
  }
  L.push(`## Your responses to the evidence (Checkpoint 2)`, "");
  if (log.responses.length) {
    for (const r of log.responses) {
      L.push(`**${r.side === "against" ? "Counter-evidence" : "Supporting evidence"}:** “${r.quote}” (${r.interview})`, "", `> ${r.response.replace(/\n+/g, " ")}`, "");
    }
  } else {
    L.push("_No responses were required for this decision._", "");
  }
  L.push(`## Calibration`, "", log.calibration.reflection, "");
  L.push("---", "", "_Generated by signol. signol never makes the decision; the founder does._");
  return L.join("\n");
}

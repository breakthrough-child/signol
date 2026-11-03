import type { ScoredStatement, StatementType } from "@/lib/types";

/** Evidence weights per statement type (deterministic; the LLM never scores). */
export const BASE_WEIGHTS: Record<StatementType, number> = {
  past_behavior: 1,
  current_pain: 0.7,
  future_promise: 0.25,
  opinion_general: 0.15,
  compliment: 0,
  irrelevant: 0,
};
/** Answers following a leading question are down-weighted by this factor. */
export const TAINT_MULTIPLIER = 0.4;
/** A statement counts as "strong evidence" at or above this weight (and untainted). */
export const STRONG_THRESHOLD = 0.7;

export type Strength = "strong" | "medium" | "weak" | "none";

export function statementWeight(type: StatementType, tainted: boolean): number {
  const w = BASE_WEIGHTS[type] ?? 0;
  return tainted ? Math.round(w * TAINT_MULTIPLIER * 1000) / 1000 : w;
}

export function strengthOf(weight: number): Strength {
  if (weight >= 0.85) return "strong";
  if (weight >= 0.5) return "medium";
  if (weight > 0.1) return "weak";
  return "none";
}

export function isStrong(s: Pick<ScoredStatement, "type" | "tainted">): boolean {
  return statementWeight(s.type, s.tainted) >= STRONG_THRESHOLD;
}

export interface InterviewScore {
  interviewId: string;
  label: string;
  weightFor: number;
  weightAgainst: number;
  strongFor: number;
  strongAgainst: number;
  /** Evidence-based: strong supporting statements outnumber strong counter-statements, and weighted for > against. */
  supports: boolean;
}

export interface ScoreResult {
  verifiedCount: number;
  unverifiedCount: number;
  positiveSounding: {
    total: number;
    compliments: number;
    promises: number;
    other: number;
    /** % of positive-sounding feedback that was only compliments or future promises. */
    pctNotEvidence: number;
  };
  strongFor: number;
  strongAgainst: number;
  weightFor: number;
  weightAgainst: number;
  tainted: number;
  byType: Record<StatementType, number>;
  perInterview: InterviewScore[];
  supporters: number;
  interviewCount: number;
  headline: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function computeScore(
  statements: ScoredStatement[],
  interviews: { id: string; label: string }[],
): ScoreResult {
  const verified = statements.filter((s) => s.verified && s.type !== "irrelevant");
  const byType = {
    past_behavior: 0,
    current_pain: 0,
    future_promise: 0,
    compliment: 0,
    opinion_general: 0,
    irrelevant: 0,
  } as Record<StatementType, number>;
  for (const s of verified) byType[s.type]++;

  const positive = verified.filter((s) => s.stance === "supports" || s.type === "compliment");
  const compliments = positive.filter((s) => s.type === "compliment").length;
  const promises = positive.filter((s) => s.type === "future_promise").length;
  const other = positive.length - compliments - promises;
  const pctNotEvidence = positive.length
    ? Math.round(((compliments + promises) / positive.length) * 100)
    : 0;

  let strongFor = 0;
  let strongAgainst = 0;
  let weightFor = 0;
  let weightAgainst = 0;
  let tainted = 0;
  const per = new Map<string, InterviewScore>(
    interviews.map((i) => [
      i.id,
      {
        interviewId: i.id,
        label: i.label,
        weightFor: 0,
        weightAgainst: 0,
        strongFor: 0,
        strongAgainst: 0,
        supports: false,
      },
    ]),
  );

  for (const s of verified) {
    const w = statementWeight(s.type, s.tainted);
    if (s.tainted) tainted++;
    const p = per.get(s.interview_id);
    if (s.stance === "supports") {
      weightFor += w;
      if (isStrong(s)) strongFor++;
      if (p) {
        p.weightFor += w;
        if (isStrong(s)) p.strongFor++;
      }
    } else if (s.stance === "contradicts") {
      weightAgainst += w;
      if (isStrong(s)) strongAgainst++;
      if (p) {
        p.weightAgainst += w;
        if (isStrong(s)) p.strongAgainst++;
      }
    }
  }
  const perInterview = [...per.values()].map((p) => ({
    ...p,
    weightFor: round(p.weightFor),
    weightAgainst: round(p.weightAgainst),
    supports: p.strongFor >= 1 && p.strongFor > p.strongAgainst && p.weightFor > p.weightAgainst,
  }));
  const supporters = perInterview.filter((p) => p.supports).length;

  const headline = positive.length
    ? `${pctNotEvidence}% of your positive feedback was compliments or promises, not evidence.`
    : verified.length
      ? "None of the feedback sounded positive, so there is nothing to discount."
      : "No verified evidence was found in these interviews.";

  return {
    verifiedCount: verified.length,
    unverifiedCount: statements.filter((s) => !s.verified).length,
    positiveSounding: { total: positive.length, compliments, promises, other, pctNotEvidence },
    strongFor,
    strongAgainst,
    weightFor: round(weightFor),
    weightAgainst: round(weightAgainst),
    tainted,
    byType,
    perInterview,
    supporters,
    interviewCount: interviews.length,
    headline,
  };
}

export interface Calibration {
  predictedSupporters: number;
  confidence: number;
  actualSupporters: number;
  interviewCount: number;
  gap: number;
  reflection: string;
}

/** Neutral calibration: prediction vs evidence. Describes, never judges. */
export function computeCalibration(
  predictedSupporters: number,
  confidence: number,
  score: ScoreResult,
): Calibration {
  const actual = score.supporters;
  const gap = predictedSupporters - actual;
  const n = score.interviewCount;
  let reflection: string;
  if (gap === 0) {
    reflection = `You predicted ${predictedSupporters} of ${n} interviewees would support the hypothesis, and ${actual} showed strong supporting evidence (concrete past behavior or a current pain). Your stated confidence was ${confidence}%.`;
  } else if (gap > 0) {
    reflection = `You predicted ${predictedSupporters} of ${n} would support the hypothesis; ${actual} showed strong supporting evidence, a difference of ${gap}. Your stated confidence was ${confidence}%. ${score.positiveSounding.total ? `${score.positiveSounding.pctNotEvidence}% of the positive-sounding feedback was compliments or promises, which this score does not count.` : ""}`.trim();
  } else {
    reflection = `You predicted ${predictedSupporters} of ${n} would support the hypothesis; ${actual} showed strong supporting evidence, ${-gap} more than you expected. Your stated confidence was ${confidence}%.`;
  }
  reflection +=
    " Predictions and evidence often differ early on; the useful signal is noticing by how much, and why.";
  return {
    predictedSupporters,
    confidence,
    actualSupporters: actual,
    interviewCount: n,
    gap,
    reflection,
  };
}

import { z } from "zod";

export const STATEMENT_TYPES = [
  "past_behavior",
  "current_pain",
  "future_promise",
  "compliment",
  "opinion_general",
  "irrelevant",
] as const;
export type StatementType = (typeof STATEMENT_TYPES)[number];

export const STANCES = ["supports", "contradicts", "neutral"] as const;
export type Stance = (typeof STANCES)[number];

export const TYPE_LABELS: Record<StatementType, string> = {
  past_behavior: "Past behavior",
  current_pain: "Current pain",
  future_promise: "Future promise",
  compliment: "Compliment",
  opinion_general: "General opinion",
  irrelevant: "Irrelevant",
};

export type Role = "interviewer" | "interviewee";

export interface Turn {
  idx: number;
  speaker: string;
  role: Role;
  text: string;
}

/* ---------- Model output schemas (all LLM output is validated with these) ---------- */

export const classifyOutputSchema = z.object({
  statements: z.array(
    z.object({
      turn_idx: z.number().int().min(0),
      quote: z.string().min(1),
      type: z.enum(STATEMENT_TYPES),
      stance: z.enum(STANCES),
      rationale: z.string().min(1).max(500),
    }),
  ),
});
export type ClassifyOutput = z.infer<typeof classifyOutputSchema>;

export const leadingOutputSchema = z.object({
  leading_questions: z.array(
    z.object({
      turn_idx: z.number().int().min(0),
      question: z.string().min(1),
      why_leading: z.string().min(1).max(500),
      neutral_rewrite: z.string().min(1).max(500),
      tainted_turn_idxs: z.array(z.number().int().min(0)).max(6),
    }),
  ),
});
export type LeadingOutput = z.infer<typeof leadingOutputSchema>;

export const synthesisOutputSchema = z.object({
  themes: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        summary: z.string().min(1).max(500),
        statement_ids: z.array(z.string()).max(8),
      }),
    )
    .min(1)
    .max(6),
  top_for: z.array(z.object({ statement_id: z.string(), why: z.string().min(1).max(400) })).max(3),
  top_against: z
    .array(z.object({ statement_id: z.string(), why: z.string().min(1).max(400) }))
    .max(3),
  open_questions: z.array(z.string().min(1).max(300)).min(1).max(6),
});
export type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;

export const scriptOutputSchema = z.object({
  new_questions: z
    .array(z.object({ question: z.string().min(1).max(300), targets: z.string().min(1).max(300) }))
    .min(3)
    .max(5),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

/* ---------- Row shapes used by pure logic ---------- */

export interface ScoredStatement {
  id: string;
  interview_id: string;
  type: StatementType;
  stance: Stance;
  verified: boolean;
  tainted: boolean;
}

export interface PickedEvidence {
  statement_id: string;
  why: string;
}

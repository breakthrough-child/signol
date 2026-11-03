import type { Role, Stance, StatementType } from "@/lib/types";
import type { ScoreResult } from "@/lib/scoring";

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  hypothesis: string;
  target_customer: string;
  predicted_supporters: number;
  predicted_confidence: number;
  locked_at: string | null;
  status: "draft" | "locked" | "analyzing" | "analyzed" | "decided";
  is_demo: boolean;
  analysis_source: "live" | "cached" | null;
  benchmark_manual_minutes: number | null;
  created_at: string;
}

export interface InterviewRow {
  id: string;
  project_id: string;
  position: number;
  label: string;
  source_type: "paste" | "text_file" | "docx" | "audio";
  storage_path: string | null;
  original_filename: string | null;
  raw_text: string | null;
  word_count: number;
  format: "dialogue" | "notes" | null;
  speakers: { label: string; role: Role; turnCount: number; questionRatio: number; avgWords: number }[];
  needs_confirmation: boolean;
  speakers_confirmed: boolean;
  error: string | null;
}

export interface TurnRow {
  id: string;
  interview_id: string;
  idx: number;
  speaker: string;
  role: Role;
  text: string;
}

export interface StatementRow {
  id: string;
  project_id: string;
  interview_id: string;
  turn_idx: number;
  type: StatementType;
  stance: Stance;
  quote: string;
  quote_start: number | null;
  quote_end: number | null;
  rationale: string;
  verified: boolean;
  tainted: boolean;
  tainted_by: string | null;
  weight: number;
}

export interface LeadingQuestionRow {
  id: string;
  project_id: string;
  interview_id: string;
  turn_idx: number;
  question: string;
  why_leading: string;
  neutral_rewrite: string;
  tainted_turn_idxs: number[];
  verified: boolean;
}

export interface SynthesisRow {
  id: string;
  project_id: string;
  themes: { title: string; summary: string; statement_ids: string[] }[];
  top_for: { statement_id: string; why: string }[];
  top_against: { statement_id: string; why: string }[];
  open_questions: string[];
  score: ScoreResult | Record<string, never>;
  script: ScriptDoc | null;
  prompt_versions: Record<string, string>;
}

export interface ScriptDoc {
  kept: { question: string; source: string }[];
  rewritten: { original: string; rewrite: string; why: string }[];
  added: { question: string; targets: string }[];
  generatedAt: string;
}

export type StepName = "transcribe" | "normalize" | "classify" | "leading" | "verify" | "score" | "synthesize";

export interface PipelineStepRow {
  id: string;
  project_id: string;
  interview_id: string | null;
  step: StepName;
  step_key: string;
  status: "pending" | "running" | "done" | "error" | "blocked";
  note: string | null;
  error: string | null;
  attempts: number;
  updated_at: string;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  choice: "validated" | "invalidated" | "need_more_evidence";
  responses: { statement_id: string; side: "for" | "against"; response: string }[];
  calibration: import("@/lib/scoring").Calibration;
  log: import("@/lib/decision").DecisionLog;
  share_token: string | null;
  decided_at: string;
}

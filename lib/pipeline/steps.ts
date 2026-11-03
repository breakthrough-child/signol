import type { StepName } from "@/lib/db-types";

/** Execution order, grouped by phase so the UI can show a clean progress list. */
export const STEP_ORDER: StepName[] = ["transcribe", "normalize", "classify", "leading", "verify", "score", "synthesize"];

export const STEP_LABELS: Record<StepName, string> = {
  transcribe: "Transcribe audio",
  normalize: "Split into speaker turns",
  classify: "Classify statements",
  leading: "Flag leading questions",
  verify: "Verify quotes",
  score: "Score evidence",
  synthesize: "Synthesize",
};

export const stepKey = (step: StepName, interviewId?: string | null) => (interviewId ? `${step}:${interviewId}` : step);

export interface PlannedStep {
  step: StepName;
  interview_id: string | null;
  step_key: string;
}

export function planSteps(interviews: { id: string; source_type: string }[]): PlannedStep[] {
  const plan: PlannedStep[] = [];
  for (const step of STEP_ORDER) {
    if (step === "score" || step === "synthesize") {
      plan.push({ step, interview_id: null, step_key: step });
      continue;
    }
    for (const iv of interviews) {
      if (step === "transcribe" && iv.source_type !== "audio") continue;
      plan.push({ step, interview_id: iv.id, step_key: stepKey(step, iv.id) });
    }
  }
  return plan;
}

/** The next step the client should run: first error/pending in plan order (running ones are left alone). */
export function nextStep<T extends { status: string }>(rows: T[]): T | undefined {
  return rows.find((r) => r.status === "pending" || r.status === "error");
}

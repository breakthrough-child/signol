import demo from "@/seed/demo.json";
import type { StatementType, Stance } from "@/lib/types";

export interface DemoSeed {
  project: { name: string; hypothesis: string; target_customer: string; predicted_supporters: number; predicted_confidence: number };
  interviews: { label: string; text: string }[];
  cached: {
    generatedBy: string;
    statements: { key: string; interview: number; turn_idx: number; quote: string; type: StatementType; stance: Stance; rationale: string }[];
    leading: { interview: number; turn_idx: number; question: string; why_leading: string; neutral_rewrite: string; tainted_turn_idxs: number[] }[];
    synthesis: {
      themes: { title: string; summary: string; keys: string[] }[];
      top_for: { key: string; why: string }[];
      top_against: { key: string; why: string }[];
      open_questions: string[];
    };
  };
}

export const demoSeed = demo as unknown as DemoSeed;

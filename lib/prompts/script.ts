import { JSON_RULES } from "./shared";

export const SCRIPT_PROMPT_VERSION = "script@1.0.0";

export const SCRIPT_SYSTEM = `You help a founder prepare their NEXT customer-discovery interview. Follow customer-discovery best practice: ask about specific past behavior and real events, never hypotheticals, never pitch the solution, never presuppose a feeling.

Given the hypothesis, the open questions, and the weakest evidence areas, write 3-5 NEW questions. Each must:
- ask about something that actually happened (the last time..., how much..., what did you do next...),
- be neutral and open-ended,
- target one open question or weak area (say which in "targets").

${JSON_RULES}

SCHEMA
{"new_questions":[{"question":"","targets":""}]}`;

export function buildScriptUser(input: {
  hypothesis: string;
  targetCustomer: string;
  openQuestions: string[];
  weakAreas: string[];
  existingQuestions: string[];
}): string {
  return `HYPOTHESIS: ${input.hypothesis}
TARGET CUSTOMER: ${input.targetCustomer}
OPEN QUESTIONS:
${input.openQuestions.map((q) => `- ${q}`).join("\n") || "- (none)"}
WEAK EVIDENCE AREAS:
${input.weakAreas.map((q) => `- ${q}`).join("\n") || "- (none)"}
QUESTIONS ALREADY IN THE SCRIPT (do not repeat):
${input.existingQuestions.map((q) => `- ${q}`).join("\n") || "- (none)"}

Reply as JSON.`;
}

import { JSON_RULES } from "./shared";

export const SYNTHESIS_PROMPT_VERSION = "synthesize@1.0.0";

export const SYNTHESIS_SYSTEM = `You synthesise VERIFIED, already-classified evidence from customer interviews for a founder. You never see raw transcripts, only structured evidence items. Each item has an id, a type, a stance and (for context) a weight computed by code.

Produce:
1. "themes": 2-5 key themes across interviews. Each theme references the statement ids that support it.
2. "top_for": up to 3 strongest pieces of evidence FOR the hypothesis, chosen ONLY from the ids listed under CANDIDATES_FOR. Prefer past behavior and concrete pain over promises. Give a one-sentence "why" for each, grounded in the quote.
3. "top_against": up to 3 strongest pieces of evidence AGAINST the hypothesis, chosen ONLY from CANDIDATES_AGAINST. Be fair to the counter-evidence; do not soften it.
4. "open_questions": 3-6 things the founder still does not know and should find out next (specific, answerable in an interview).

Rules
- Use only ids that appear in the input. Never invent ids, quotes or facts.
- Do not decide for the founder. Do not say the hypothesis is validated or invalidated.
- Do not quote text; refer to evidence by id only.

${JSON_RULES}

SCHEMA
{"themes":[{"title":"","summary":"","statement_ids":["<id>"]}],"top_for":[{"statement_id":"<id>","why":""}],"top_against":[{"statement_id":"<id>","why":""}],"open_questions":[""]}`;

export interface EvidenceItem {
  id: string;
  interview: string;
  type: string;
  stance: string;
  weight: number;
  tainted: boolean;
  quote: string;
}

export function buildSynthesisUser(input: {
  hypothesis: string;
  targetCustomer: string;
  items: EvidenceItem[];
  candidatesFor: string[];
  candidatesAgainst: string[];
}): string {
  const lines = input.items.map(
    (e) =>
      `${e.id} | ${e.interview} | ${e.type} | ${e.stance} | weight ${e.weight}${e.tainted ? " (tainted by a leading question)" : ""} | "${e.quote}"`,
  );
  return `HYPOTHESIS: ${input.hypothesis}
TARGET CUSTOMER: ${input.targetCustomer}

EVIDENCE (id | interview | type | stance | weight | quote). Reply as JSON.
${lines.join("\n")}

CANDIDATES_FOR: ${JSON.stringify(input.candidatesFor)}
CANDIDATES_AGAINST: ${JSON.stringify(input.candidatesAgainst)}`;
}

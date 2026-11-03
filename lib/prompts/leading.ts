import type { Turn } from "@/lib/types";
import { JSON_RULES } from "./shared";

export const LEADING_PROMPT_VERSION = "leading@1.0.0";

export const LEADING_SYSTEM = `You are an expert in customer-discovery interviewing (The Mom Test). You review the INTERVIEWER's questions and flag the leading ones.

A question is LEADING if it:
- presupposes a problem or feeling ("How frustrating is tracking stock?", "Don't you hate it when...")
- pitches the solution inside the question ("Wouldn't it be great if an app did X?")
- invites agreement ("You'd use something like that, right?", "Isn't it true that...")
- asks for hypotheticals or promises about the future ("Would you pay for...?") instead of past behavior
- bundles a compliment or opinion of the founder's idea

NOT leading: open questions about past behavior ("How do you track stock today?", "Tell me about the last time you ran out of an ingredient.", "What did you do next?").

For each leading question give:
- the question exactly as spoken (verbatim, from the interviewer turn),
- why it is leading (one sentence),
- a neutral rewrite that asks about past behavior or facts without presupposing anything,
- the interviewee turn indexes (at most 3, only turns AFTER the question) whose answers may have been influenced.

${JSON_RULES}

SCHEMA
{"leading_questions":[{"turn_idx": <interviewer turn index>, "question": "<verbatim leading question>", "why_leading": "<one sentence>", "neutral_rewrite": "<neutral question>", "tainted_turn_idxs": [<interviewee turn indexes>]}]}

Only include questions that are genuinely leading. If there are none, return {"leading_questions":[]}.`;

export function buildLeadingUser(input: {
  hypothesis: string;
  interviewLabel: string;
  turns: Turn[];
}): string {
  const out: string[] = [];
  for (let i = 0; i < input.turns.length; i++) {
    const t = input.turns[i];
    if (t.role !== "interviewer") continue;
    const next = input.turns.slice(i + 1).find((x) => x.role === "interviewee");
    out.push(`[${t.idx}] INTERVIEWER: ${t.text}`);
    if (next) {
      const preview = next.text.split(/\s+/).slice(0, 30).join(" ");
      out.push(`    -> next interviewee turn [${next.idx}] begins: "${preview}"`);
    }
  }
  return `HYPOTHESIS (context only): ${input.hypothesis}
INTERVIEW: ${input.interviewLabel}

INTERVIEWER QUESTIONS (turn index in brackets; reply as JSON):
${out.join("\n")}`;
}

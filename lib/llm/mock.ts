import type { Turn } from "@/lib/types";
import type { EvidenceItem } from "@/lib/prompts/synthesize";
import type { LlmAdapter, LlmRequest, LlmResponse } from "./types";

/**
 * Offline, deterministic heuristic "provider" used ONLY for local development
 * and automated tests (LLM_PROVIDER_ORDER=mock). It is not a language model:
 * it applies keyword rules to the structured payload. The UI shows the provider
 * name on every run so mock output can never be mistaken for model output.
 */

const RE = {
  compliment:
    /\b(great idea|brilliant|love (it|that|this|the idea)|amazing|fantastic|genius|excellent|smart idea|sounds great|sounds amazing|really cool|very nice|wonderful|good idea|fantastic idea)\b/i,
  promise:
    /\b(i would|i'd|i will|i'll|we would|we'd|i could see myself|i'm sure i|sign me up|count me in|definitely (use|pay|buy|try)|i('d| would) (pay|use|try|buy)|i might|i would probably|i'd probably)\b/i,
  past: /\b(last (year|month|week|march|april|may|june|july|december|january|february)|every (day|night|morning|evening|week|month)|each (night|day|week)|we (use|used|track|tracked|pay|paid|spent|bought|tried|stopped|write|wrote|count|counted|keep|kept)|i (use|used|track|tracked|paid|spent|bought|tried|stopped|write|wrote|count|counted|keep|kept|check|checked)|notebook|spreadsheet|whatsapp group|exercise book|ledger)\b/i,
  pain: /\b(lose|lost|waste|wasted|theft|stolen|steal|ran out|run out|running out|shortage|headache|struggle|costs? me|cost us|spoil|spoilt|spoiled|expired|mismatch|never match)\b/i,
  opinion: /\b(i think|most (owners|restaurants|people)|other (owners|restaurants)|in general|usually|people (in|like))\b/i,
  against:
    /\b(don't need|do not need|didn't need|no need|not worth|can't afford|cannot afford|too expensive|deleted|stopped using|gave up|never again|wouldn't (pay|use|bother)|would not (pay|use|bother)|refuse|fine with|works fine|good enough|prefer(red)? (my|the|to)|not for me|won't pay|will not pay|my staff (won't|would not|refuse)|they (won't|would not) (use|type))\b/i,
};

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

function classifySentence(s: string) {
  const words = s.split(/\s+/).length;
  if (words < 4) return null;
  const against = RE.against.test(s);
  if (RE.compliment.test(s) && !RE.past.test(s)) {
    return { type: "compliment", stance: "supports", rationale: "Praise with no behavior attached." } as const;
  }
  if (against && RE.past.test(s)) {
    return { type: "past_behavior", stance: "contradicts", rationale: "Describes something they actually did that works against the hypothesis." } as const;
  }
  if (RE.promise.test(s) && !RE.past.test(s)) {
    return {
      type: "future_promise",
      stance: against ? "contradicts" : "supports",
      rationale: "A statement about what they would do, not what they have done.",
    } as const;
  }
  if (RE.past.test(s)) {
    return {
      type: "past_behavior",
      stance: against ? "contradicts" : "supports",
      rationale: "Describes a concrete thing they do or did.",
    } as const;
  }
  if (RE.pain.test(s)) {
    return {
      type: "current_pain",
      stance: against ? "contradicts" : "supports",
      rationale: "Names a specific problem they have now.",
    } as const;
  }
  if (against) {
    return { type: "opinion_general", stance: "contradicts", rationale: "States a view that works against the hypothesis." } as const;
  }
  if (RE.opinion.test(s)) {
    return { type: "opinion_general", stance: "neutral", rationale: "A general opinion without personal behavior." } as const;
  }
  return null;
}

export function mockClassify(payload: { turns: Turn[] }) {
  const statements: unknown[] = [];
  for (const t of payload.turns) {
    if (t.role !== "interviewee") continue;
    let n = 0;
    for (const s of sentences(t.text)) {
      const c = classifySentence(s);
      if (!c) continue;
      statements.push({ turn_idx: t.idx, quote: s, ...c });
      if (++n >= 3) break;
    }
  }
  return { statements: statements.slice(0, 14) };
}

const LEADING_RE =
  /(wouldn't it be|wouldn't you|don't you (hate|think|find|wish)|isn't (it|that)|you'd (use|love|want|agree)|you would (use|love|want)|how (annoying|frustrating)|surely|right\?\s*$|wouldn't that)/i;

export function mockLeading(payload: { turns: Turn[] }) {
  const out: unknown[] = [];
  const { turns } = payload;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "interviewer") continue;
    const q = sentences(t.text).find((s) => LEADING_RE.test(s));
    if (!q) continue;
    const answers = turns.slice(i + 1).filter((x) => x.role === "interviewee").slice(0, 1);
    out.push({
      turn_idx: t.idx,
      question: q,
      why_leading: "It presupposes a problem or invites agreement instead of asking what actually happened.",
      neutral_rewrite: "Tell me about the last time you handled this. What did you do, step by step?",
      tainted_turn_idxs: answers.map((a) => a.idx),
    });
  }
  return { leading_questions: out };
}

export function mockSynthesize(payload: {
  items: EvidenceItem[];
  candidatesFor: string[];
  candidatesAgainst: string[];
}) {
  const byId = new Map(payload.items.map((i) => [i.id, i]));
  const pick = (ids: string[]) =>
    ids.slice(0, 3).map((id) => ({
      statement_id: id,
      why: `${byId.get(id)?.type.replace("_", " ")} from ${byId.get(id)?.interview}: concrete enough to weigh.`,
    }));
  const group = (type: string) => payload.items.filter((i) => i.type === type).map((i) => i.id).slice(0, 6);
  const themes = [
    { title: "How inventory is tracked today", summary: "Interviewees describe manual routines such as notebooks, spreadsheets and chat groups.", statement_ids: group("past_behavior") },
    { title: "Enthusiasm without commitment", summary: "Many positive reactions are compliments or promises rather than behavior.", statement_ids: [...group("compliment"), ...group("future_promise")].slice(0, 6) },
    { title: "Concrete pains", summary: "A few owners cite specific losses from stock mismatches or waste.", statement_ids: group("current_pain") },
  ].filter((t) => t.statement_ids.length > 0);
  return {
    themes: themes.length ? themes : [{ title: "Not enough evidence", summary: "Too little verified evidence to summarise themes.", statement_ids: [] }],
    top_for: pick(payload.candidatesFor),
    top_against: pick(payload.candidatesAgainst),
    open_questions: [
      "Who actually pays for tools in the business: the owner or the manager?",
      "What happened the last time they tried to replace the notebook or spreadsheet?",
      "How much stock loss per month can each owner point to, in naira?",
    ],
  };
}

export function mockScript() {
  return {
    new_questions: [
      { question: "Tell me about the last time your stock count did not match what you expected. What happened next?", targets: "Size of the real, recent pain" },
      { question: "What have you already tried to fix this, and what happened to it?", targets: "Past attempts and why they failed" },
      { question: "Who decides when money is spent on a new tool, and what was the last one you paid for?", targets: "Buying process and willingness to pay" },
    ],
  };
}

export function createMockAdapter(): LlmAdapter {
  return {
    name: "mock",
    isConfigured: () => true,
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const started = Date.now();
      const p = req.payload as never;
      let out: unknown;
      switch (req.task) {
        case "classify":
          out = mockClassify(p);
          break;
        case "leading":
          out = mockLeading(p);
          break;
        case "synthesize":
          out = mockSynthesize(p);
          break;
        case "script":
          out = mockScript();
          break;
        default:
          out = {};
      }
      const text = JSON.stringify(out);
      return {
        text,
        provider: "mock",
        model: "heuristic-v1",
        tokensIn: Math.ceil((req.system.length + req.user.length) / 4),
        tokensOut: Math.ceil(text.length / 4),
        latencyMs: Date.now() - started,
      };
    },
  };
}

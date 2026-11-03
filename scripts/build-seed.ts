/**
 * Builds the demo data from the annotated sources in seed/src:
 *   seed/interviews/*.md   plain transcripts (what a user would paste)
 *   seed/demo.json         project + interviews + the cached analysis used as the demo fallback
 *
 * Annotations in seed/src/*.md (stripped from the transcripts):
 *   {{pb+|rationale|quote}}   type: pb past_behavior, cp current_pain, fp future_promise, cm compliment, og opinion_general
 *                              stance: + supports, - contradicts, 0 neutral
 *   {{lq|why leading|neutral rewrite|question}}   a leading interviewer question
 * Every annotated quote is verified against the generated transcript by the SAME code the app uses.
 *
 *   npx tsx scripts/build-seed.ts
 */
import fs from "node:fs";
import path from "node:path";
import { computeScore } from "../lib/scoring";
import { parseTranscript } from "../lib/text/parse";
import { resolveTaintedTurns, verifyQuote } from "../lib/verify";
import type { Stance, StatementType } from "../lib/types";
import { statementWeight } from "../lib/scoring";

const SRC = path.resolve(import.meta.dirname, "../seed/src");
const OUT = path.resolve(import.meta.dirname, "../seed");

const TYPES: Record<string, StatementType> = { pb: "past_behavior", cp: "current_pain", fp: "future_promise", cm: "compliment", og: "opinion_general" };
const STANCES: Record<string, Stance> = { "+": "supports", "-": "contradicts", "0": "neutral" };

interface Ann { kind: "st"; type: StatementType; stance: Stance; rationale: string; quote: string }
interface Lq { kind: "lq"; why: string; rewrite: string; question: string }

function parseSource(raw: string) {
  const lines = raw.split("\n");
  const label = lines[0].replace(/^#\s*/, "").trim();
  const body = lines.slice(1).join("\n").trim();
  const anns: (Ann | Lq)[] = [];
  const plain = body.replace(/\{\{([^}]*)\}\}/g, (_m, inner: string) => {
    const parts = inner.split("|");
    const head = parts[0];
    if (head === "lq") {
      const [, why, rewrite, ...q] = parts;
      anns.push({ kind: "lq", why, rewrite, question: q.join("|") });
      return q.join("|");
    }
    const m = head.match(/^(pb|cp|fp|cm|og)([+\-0])$/);
    if (!m) throw new Error(`Bad annotation head: ${head}`);
    const [, rationale, ...q] = parts;
    anns.push({ kind: "st", type: TYPES[m[1]], stance: STANCES[m[2]], rationale, quote: q.join("|") });
    return q.join("|");
  });
  return { label, plain, anns };
}

const files = fs.readdirSync(SRC).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
fs.mkdirSync(path.join(OUT, "interviews"), { recursive: true });

const interviews: { label: string; text: string }[] = [];
const statements: { key: string; interview: number; turn_idx: number; quote: string; type: StatementType; stance: Stance; rationale: string }[] = [];
const leading: { interview: number; turn_idx: number; question: string; why_leading: string; neutral_rewrite: string; tainted_turn_idxs: number[] }[] = [];
let problems = 0;

files.forEach((f, i) => {
  const { label, plain, anns } = parseSource(fs.readFileSync(path.join(SRC, f), "utf8"));
  const words = plain.split(/\s+/).length;
  const hint = label.match(/:\s*([^,]+)/)?.[1]?.trim();
  const parsed = parseTranscript(plain, hint);
  if (parsed.format !== "dialogue" || parsed.needsConfirmation) {
    console.error(`!! ${f}: parse produced ${parsed.format}, needsConfirmation=${parsed.needsConfirmation}`);
    problems++;
  }
  if (words < 800 || words > 1500) {
    console.error(`!! ${f}: ${words} words (must be 800-1500)`);
    problems++;
  }
  fs.writeFileSync(path.join(OUT, "interviews", f.replace(/^(\d\d)-/, "interview-$1-")), plain + "\n");
  interviews.push({ label, text: plain });
  let n = 0;
  for (const a of anns) {
    if (a.kind === "st") {
      const c = verifyQuote(a.quote, 0, parsed.turns, "interviewee");
      if (!c.verified) {
        console.error(`!! ${f}: quote not found in an interviewee turn: ${a.quote}`);
        problems++;
        continue;
      }
      statements.push({ key: `i${i + 1}s${++n}`, interview: i, turn_idx: c.turn_idx, quote: c.quote, type: a.type, stance: a.stance, rationale: a.rationale });
    } else {
      const c = verifyQuote(a.question, 0, parsed.turns, "interviewer");
      if (!c.verified) {
        console.error(`!! ${f}: leading question not found: ${a.question}`);
        problems++;
        continue;
      }
      leading.push({ interview: i, turn_idx: c.turn_idx, question: c.quote, why_leading: a.why, neutral_rewrite: a.rewrite, tainted_turn_idxs: resolveTaintedTurns(c.turn_idx, [], parsed.turns) });
    }
  }
  console.log(`${f}: ${words} words, ${parsed.turns.length} turns, ${anns.length} annotations`);
});

// Hand-written synthesis (matches by substring of the quote so it survives edits to wording)
const synSrc = JSON.parse(fs.readFileSync(path.join(SRC, "synthesis.json"), "utf8")) as {
  themes: { title: string; summary: string; match: string[] }[];
  top_for: { match: string; why: string }[];
  top_against: { match: string; why: string }[];
  open_questions: string[];
};
const keyFor = (needle: string) => {
  const hits = statements.filter((s) => s.quote.toLowerCase().includes(needle.toLowerCase()));
  if (hits.length !== 1) {
    console.error(`!! synthesis match "${needle}" matched ${hits.length} statements`);
    problems++;
    return hits[0]?.key ?? "";
  }
  return hits[0].key;
};
const synthesis = {
  themes: synSrc.themes.map((t) => ({ title: t.title, summary: t.summary, keys: t.match.map(keyFor) })),
  top_for: synSrc.top_for.map((p) => ({ key: keyFor(p.match), why: p.why })),
  top_against: synSrc.top_against.map((p) => ({ key: keyFor(p.match), why: p.why })),
  open_questions: synSrc.open_questions,
};

// Report what the app's scoring will show for this cache
const taintSet = new Set(leading.flatMap((q) => q.tainted_turn_idxs.map((t) => `${q.interview}:${t}`)));
const scored = statements.map((s, i) => ({ id: String(i), interview_id: String(s.interview), type: s.type, stance: s.stance, verified: true, tainted: taintSet.has(`${s.interview}:${s.turn_idx}`) }));
const score = computeScore(scored, interviews.map((iv, i) => ({ id: String(i), label: iv.label })));
console.log("\nscore preview:", JSON.stringify({ headline: score.headline, strongFor: score.strongFor, strongAgainst: score.strongAgainst, tainted: score.tainted, supporters: score.supporters, byType: score.byType, leading: leading.length }, null, 1));
void statementWeight;

const demo = {
  project: {
    name: "Lagos restaurants: inventory app (demo)",
    hypothesis: "Small restaurant owners in Lagos will pay monthly for an app that automates inventory tracking.",
    target_customer: "Owners of small restaurants, bukas and canteens in Lagos, Nigeria (10-60 seats, 5-15 staff)",
    predicted_supporters: 5,
    predicted_confidence: 80,
  },
  interviews,
  cached: {
    generatedBy: "curated by the signol authors from annotated demo transcripts (seed/src); regenerate with `npm run cache:demo` using a live model",
    statements,
    leading,
    synthesis,
  },
};
fs.writeFileSync(path.join(OUT, "demo.json"), JSON.stringify(demo, null, 2) + "\n");
if (problems) {
  console.error(`\n${problems} problem(s)`);
  process.exit(1);
}
console.log("\nwrote seed/demo.json");

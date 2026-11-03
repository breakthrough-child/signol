/**
 * Regenerates seed/demo.json's cached analysis from a REAL model run, so the demo fallback is genuine
 * model output instead of the curated annotations. Requires GROQ_API_KEY and/or GEMINI_API_KEY.
 *
 *   npx tsx scripts/cache-demo.mts
 *
 * It runs the same prompts, chunking and code-level verification as the app, over the 6 demo transcripts,
 * keeps only quotes that verify, and writes the result back into seed/demo.json (backing up the old file).
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
loadEnv({ path: ".env.local" });

import { config } from "../lib/config";
import { getLlm } from "../lib/llm";
import { CLASSIFY_SYSTEM, LEADING_SYSTEM, SYNTHESIS_SYSTEM, buildClassifyUser, buildLeadingUser, buildSynthesisUser } from "../lib/prompts";
import { statementWeight } from "../lib/scoring";
import { chunkTurns } from "../lib/text/chunk";
import { parseTranscript } from "../lib/text/parse";
import { classifyOutputSchema, leadingOutputSchema, synthesisOutputSchema } from "../lib/types";
import { resolveTaintedTurns, verifyQuote } from "../lib/verify";

if (!config.groq.apiKey && !config.gemini.apiKey) {
  console.error("Set GROQ_API_KEY and/or GEMINI_API_KEY in .env.local first.");
  process.exit(1);
}
const file = path.resolve(import.meta.dirname, "../seed/demo.json");
const demo = JSON.parse(fs.readFileSync(file, "utf8"));
fs.copyFileSync(file, file.replace(/\.json$/, ".curated.json"));
const llm = getLlm({ onEvent: (e) => console.log("  ·", JSON.stringify(e)) });
const hyp = demo.project.hypothesis as string;
const tc = demo.project.target_customer as string;

interface Stmt { key: string; interview: number; turn_idx: number; quote: string; type: string; stance: string; rationale: string }
const statements: Stmt[] = [];
const leading: Record<string, unknown>[] = [];
const taint = new Set<string>();
for (let i = 0; i < demo.interviews.length; i++) {
  const iv = demo.interviews[i];
  const parsed = parseTranscript(iv.text, iv.label.match(/:\s*([^,]+)/)?.[1]);
  console.log(`Interview ${i + 1}: ${parsed.turns.length} turns`);
  let n = 0;
  for (const chunk of chunkTurns(parsed.turns, config.limits.chunkWords)) {
    const r = await llm.json({ step: "classify", task: "classify", system: CLASSIFY_SYSTEM, user: buildClassifyUser({ hypothesis: hyp, targetCustomer: tc, interviewLabel: iv.label, turns: chunk.turns }), schema: classifyOutputSchema, maxTokens: 3000 });
    for (const s of r.data.statements) {
      if (s.type === "irrelevant") continue;
      const c = verifyQuote(s.quote, s.turn_idx, parsed.turns, "interviewee");
      if (!c.verified) { console.log("  dropped unverifiable quote:", s.quote.slice(0, 60)); continue; }
      statements.push({ key: `i${i + 1}s${++n}`, interview: i, turn_idx: c.turn_idx, quote: c.quote, type: s.type, stance: s.stance, rationale: s.rationale });
    }
  }
  const lr = await llm.json({ step: "leading", task: "leading", system: LEADING_SYSTEM, user: buildLeadingUser({ hypothesis: hyp, interviewLabel: iv.label, turns: parsed.turns }), schema: leadingOutputSchema, maxTokens: 2000 });
  for (const q of lr.data.leading_questions) {
    const c = verifyQuote(q.question, q.turn_idx, parsed.turns, "interviewer");
    if (!c.verified) continue;
    const t = resolveTaintedTurns(c.turn_idx, q.tainted_turn_idxs, parsed.turns);
    t.forEach((x) => taint.add(`${i}:${x}`));
    leading.push({ interview: i, turn_idx: c.turn_idx, question: c.quote, why_leading: q.why_leading, neutral_rewrite: q.neutral_rewrite, tainted_turn_idxs: t });
  }
}

const weight = (s: Stmt) => statementWeight(s.type as never, taint.has(`${s.interview}:${s.turn_idx}`));
const cands = (stance: string) => statements.filter((s) => s.stance === stance && weight(s) > 0).sort((a, b) => weight(b) - weight(a)).slice(0, 6);
const cf = cands("supports"), ca = cands("contradicts");
const items = statements.filter((s) => weight(s) > 0 || s.type === "compliment").slice(0, 60).map((s) => ({ id: s.key, interview: demo.interviews[s.interview].label, type: s.type, stance: s.stance, weight: weight(s), tainted: taint.has(`${s.interview}:${s.turn_idx}`), quote: s.quote.slice(0, 220) }));
const syn = await llm.json({ step: "synthesize", task: "synthesize", system: SYNTHESIS_SYSTEM, user: buildSynthesisUser({ hypothesis: hyp, targetCustomer: tc, items, candidatesFor: cf.map((s) => s.key), candidatesAgainst: ca.map((s) => s.key) }), schema: synthesisOutputSchema, maxTokens: 2500 });
const valid = new Set(statements.map((s) => s.key));
const pick = (p: { statement_id: string; why: string }[], c: Stmt[]) => {
  const ok = p.filter((x) => c.some((y) => y.key === x.statement_id));
  for (const s of c) if (ok.length < Math.min(3, c.length) && !ok.some((x) => x.statement_id === s.key)) ok.push({ statement_id: s.key, why: s.rationale });
  return ok.slice(0, 3).map((x) => ({ key: x.statement_id, why: x.why }));
};
demo.cached = {
  generatedBy: `live model run (${config.providerOrder.join(",")}; ${config.groq.chatModel} / ${config.gemini.model}) on ${new Date().toISOString().slice(0, 10)}`,
  statements,
  leading,
  synthesis: {
    themes: syn.data.themes.map((t) => ({ title: t.title, summary: t.summary, keys: t.statement_ids.filter((k) => valid.has(k)) })),
    top_for: pick(syn.data.top_for, cf),
    top_against: pick(syn.data.top_against, ca),
    open_questions: syn.data.open_questions,
  },
};
fs.writeFileSync(file, JSON.stringify(demo, null, 2) + "\n");
console.log(`Wrote ${statements.length} statements and ${leading.length} leading questions to seed/demo.json (previous version kept as demo.curated.json).`);

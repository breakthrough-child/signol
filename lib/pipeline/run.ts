import { config } from "@/lib/config";
import type { InterviewRow, LeadingQuestionRow, PipelineStepRow, StatementRow, StepName, SynthesisRow, TurnRow } from "@/lib/db-types";
import { transcribeAudio } from "@/lib/llm/transcribe";
import { PROMPT_VERSIONS, buildClassifyUser, buildLeadingUser, buildSynthesisUser, CLASSIFY_SYSTEM, LEADING_SYSTEM, SYNTHESIS_SYSTEM } from "@/lib/prompts";
import { computeScore, statementWeight, strengthOf } from "@/lib/scoring";
import { chunkTurns } from "@/lib/text/chunk";
import { normalizeText } from "@/lib/text/match";
import { parseTranscript } from "@/lib/text/parse";
import { classifyOutputSchema, leadingOutputSchema, synthesisOutputSchema, type Turn } from "@/lib/types";
import { resolveTaintedTurns, verifyQuote } from "@/lib/verify";
import { wordCount } from "@/lib/utils";
import type { PipelineCtx } from "./context";

export class StepBlocked extends Error {}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

async function getInterview(ctx: PipelineCtx, id: string): Promise<InterviewRow> {
  const r = await ctx.supabase.from("interviews").select("*").eq("id", id).maybeSingle();
  const data = must(r, "load interview");
  if (!data) throw new Error("Interview not found");
  return data as InterviewRow;
}

async function getTurns(ctx: PipelineCtx, interviewId: string): Promise<Turn[]> {
  const r = await ctx.supabase.from("turns").select("*").eq("interview_id", interviewId).order("idx", { ascending: true });
  return (must(r, "load turns") as TurnRow[]).map((t) => ({ idx: t.idx, speaker: t.speaker, role: t.role, text: t.text }));
}

export function friendlyStepError(step: StepName, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (step === "transcribe") return `Transcription failed. ${msg}`;
  return msg;
}

/* ------------------------------------------------------------------ transcribe */

async function transcribe(ctx: PipelineCtx, iv: InterviewRow) {
  if (!iv.storage_path) throw new Error("No audio file stored for this interview.");
  const dl = await ctx.supabase.storage.from("interviews").download(iv.storage_path);
  if (dl.error || !dl.data) throw new Error(`Could not read the uploaded audio (${dl.error?.message ?? "missing"}).`);
  const blob = dl.data;
  if (blob.size > config.limits.maxFileMb * 1024 * 1024) throw new Error(`Audio is larger than ${config.limits.maxFileMb} MB.`);
  const name = iv.original_filename ?? "audio.mp3";
  const mime = /\.m4a$/i.test(name) ? "audio/mp4" : /\.wav$/i.test(name) ? "audio/wav" : "audio/mpeg";
  const t0 = Date.now();
  const res = await transcribeAudio(blob, name, mime);
  await ctx.log({ step: "transcribe", provider: res.provider, model: res.model, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - t0 });
  if (wordCount(res.text) < 20) throw new Error("No speech was detected in this recording (or it is too short to analyse).");
  must(await ctx.supabase.from("interviews").update({ raw_text: res.text, word_count: wordCount(res.text), error: null }).eq("id", iv.id).select(), "save transcript");
  return { note: `Transcribed with ${res.provider} (${res.model})` };
}

/* ------------------------------------------------------------------ normalize */

function intervieweeHint(label: string): string | undefined {
  const m = label.match(/:\s*([^,–—(]+)/);
  const name = m?.[1]?.trim();
  return name && name.length < 40 ? name.split(/\s+/)[0] : undefined;
}

async function normalize(ctx: PipelineCtx, iv: InterviewRow) {
  const text = (iv.raw_text ?? "").trim();
  if (wordCount(text) < 20) throw new Error("This interview is empty or too short to analyse (it needs at least 20 words). Interviews cannot change once analysis has started, so create a new project with the full transcript.");
  const parsed = parseTranscript(text, intervieweeHint(iv.label));
  if (!parsed.turns.some((t) => t.role === "interviewee")) throw new Error("Could not find any interviewee speech in this transcript.");
  must(await ctx.supabase.from("turns").delete().eq("interview_id", iv.id).select("id"), "reset turns");
  const rows = parsed.turns.map((t) => ({ project_id: ctx.project.id, interview_id: iv.id, idx: t.idx, speaker: t.speaker, role: t.role, text: t.text }));
  for (let i = 0; i < rows.length; i += 200) must(await ctx.supabase.from("turns").insert(rows.slice(i, i + 200)).select("id"), "save turns");
  must(
    await ctx.supabase
      .from("interviews")
      .update({ format: parsed.format, speakers: parsed.speakers, needs_confirmation: parsed.needsConfirmation, speakers_confirmed: false, word_count: wordCount(text), error: null })
      .eq("id", iv.id)
      .select("id"),
    "save interview",
  );
  return { note: parsed.needsConfirmation ? "Needs confirmation: who is the interviewer?" : `${parsed.turns.length} turns · ${parsed.format}` };
}

function assertSpeakersReady(iv: InterviewRow) {
  if (iv.needs_confirmation && !iv.speakers_confirmed) throw new StepBlocked("Confirm who is the interviewer in this transcript to continue.");
}

/* ------------------------------------------------------------------ classify */

async function classify(ctx: PipelineCtx, iv: InterviewRow) {
  assertSpeakersReady(iv);
  const turns = await getTurns(ctx, iv.id);
  if (!turns.length) throw new Error("This interview has not been split into turns yet.");
  const chunks = chunkTurns(turns, config.limits.chunkWords);
  const llm = ctx.llmFor(`classify:${iv.id}`);
  const seen = new Set<string>();
  const out: Omit<StatementRow, "id">[] = [];
  const isInterviewee = new Set(turns.filter((t) => t.role === "interviewee").map((t) => t.idx));

  for (const chunk of chunks) {
    const res = await llm.json({
      step: "classify",
      task: "classify",
      system: CLASSIFY_SYSTEM,
      user: buildClassifyUser({ hypothesis: ctx.project.hypothesis, targetCustomer: ctx.project.target_customer, interviewLabel: iv.label, turns: chunk.turns }),
      schema: classifyOutputSchema,
      payload: { hypothesis: ctx.project.hypothesis, turns: chunk.turns },
      maxTokens: 3000,
    });
    for (const s of res.data.statements) {
      if (s.type === "irrelevant") continue;
      const key = `${s.turn_idx}|${normalizeText(s.quote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        project_id: ctx.project.id,
        interview_id: iv.id,
        turn_idx: isInterviewee.has(s.turn_idx) ? s.turn_idx : (chunk.turns.find((t) => t.role === "interviewee")?.idx ?? s.turn_idx),
        type: s.type,
        stance: s.stance,
        quote: s.quote.trim(),
        quote_start: null,
        quote_end: null,
        rationale: s.rationale.trim(),
        verified: false,
        tainted: false,
        tainted_by: null,
        weight: statementWeight(s.type, false),
      });
    }
  }
  must(await ctx.supabase.from("statements").delete().eq("interview_id", iv.id).select("id"), "reset statements");
  const capped = out.slice(0, 40);
  for (let i = 0; i < capped.length; i += 100) must(await ctx.supabase.from("statements").insert(capped.slice(i, i + 100)).select("id"), "save statements");
  return { note: capped.length ? `${capped.length} statements classified` : "No statements relevant to the hypothesis were found in this interview." };
}

/* ------------------------------------------------------------------ leading questions */

async function leading(ctx: PipelineCtx, iv: InterviewRow) {
  assertSpeakersReady(iv);
  const turns = await getTurns(ctx, iv.id);
  must(await ctx.supabase.from("leading_questions").delete().eq("interview_id", iv.id).select("id"), "reset leading questions");
  const questions = turns.filter((t) => t.role === "interviewer");
  if (iv.format === "notes" || questions.length === 0) return { note: "No interviewer questions to review (notes format)." };
  const llm = ctx.llmFor(`leading:${iv.id}`);
  const rows: Omit<LeadingQuestionRow, "id">[] = [];
  const groupSize = 25;
  const seenTurn = new Set<number>();
  for (let i = 0; i < questions.length; i += groupSize) {
    const group = questions.slice(i, i + groupSize);
    const first = group[0].idx;
    const last = group[group.length - 1].idx;
    // include the answers between the group's questions so each question can show its answer preview
    const slice = turns.filter((t) => t.idx >= first && t.idx <= last + 2);
    const res = await llm.json({
      step: "leading",
      task: "leading",
      system: LEADING_SYSTEM,
      user: buildLeadingUser({ hypothesis: ctx.project.hypothesis, interviewLabel: iv.label, turns: slice.filter((t) => t.role === "interviewer" ? group.some((g) => g.idx === t.idx) : true) }),
      schema: leadingOutputSchema,
      payload: { turns: slice },
      maxTokens: 2000,
    });
    for (const q of res.data.leading_questions) {
      if (seenTurn.has(q.turn_idx)) continue;
      seenTurn.add(q.turn_idx);
      rows.push({
        project_id: ctx.project.id,
        interview_id: iv.id,
        turn_idx: q.turn_idx,
        question: q.question.trim(),
        why_leading: q.why_leading.trim(),
        neutral_rewrite: q.neutral_rewrite.trim(),
        tainted_turn_idxs: q.tainted_turn_idxs,
        verified: false,
      });
    }
  }
  if (rows.length) must(await ctx.supabase.from("leading_questions").insert(rows).select("id"), "save leading questions");
  return { note: rows.length ? `${rows.length} leading question${rows.length === 1 ? "" : "s"} flagged` : "No leading questions found." };
}

/* ------------------------------------------------------------------ verify (code only, no LLM) */

export async function verifyInterview(ctx: PipelineCtx, interviewId: string): Promise<{ verified: number; total: number; tainted: number }> {
  const turns = await getTurns(ctx, interviewId);
  const stRes = await ctx.supabase.from("statements").select("*").eq("interview_id", interviewId);
  const statements = must(stRes, "load statements") as StatementRow[];
  const lqRes = await ctx.supabase.from("leading_questions").select("*").eq("interview_id", interviewId);
  const lqs = must(lqRes, "load leading questions") as LeadingQuestionRow[];
  const turnText = new Map(turns.map((t) => [t.idx, t.text]));

  // 1. verify leading questions against interviewer turns, then work out the tainted answers
  const taint = new Map<number, string>(); // answer turn idx -> leading question id
  const lqUpdates = lqs.map((q) => {
    const c = verifyQuote(q.question, q.turn_idx, turns, "interviewer");
    const tainted_turn_idxs = c.verified ? resolveTaintedTurns(c.turn_idx, q.tainted_turn_idxs ?? [], turns) : [];
    if (c.verified) for (const i of tainted_turn_idxs) if (!taint.has(i)) taint.set(i, q.id);
    return { ...q, question: c.verified ? c.quote : q.question, turn_idx: c.turn_idx, verified: c.verified, tainted_turn_idxs };
  });
  if (lqUpdates.length) must(await ctx.supabase.from("leading_questions").upsert(lqUpdates, { onConflict: "id" }).select("id"), "update leading questions");

  // 2. verify statements against interviewee turns (the anti-hallucination guarantee)
  let verified = 0;
  let tainted = 0;
  const updates = statements.map((s) => {
    const c = verifyQuote(s.quote, s.turn_idx, turns, "interviewee");
    const isTainted = c.verified && taint.has(c.turn_idx);
    let start: number | null = null;
    let end: number | null = null;
    if (c.verified) {
      const text = turnText.get(c.turn_idx) ?? "";
      const at = text.indexOf(c.quote);
      if (at >= 0) {
        start = at;
        end = at + c.quote.length;
      }
      verified++;
    }
    if (isTainted) tainted++;
    return {
      ...s,
      quote: c.verified ? c.quote : s.quote,
      turn_idx: c.turn_idx,
      verified: c.verified,
      tainted: isTainted,
      tainted_by: isTainted ? (taint.get(c.turn_idx) ?? null) : null,
      quote_start: start,
      quote_end: end,
      weight: statementWeight(s.type, isTainted),
    };
  });
  if (updates.length) must(await ctx.supabase.from("statements").upsert(updates, { onConflict: "id" }).select("id"), "update statements");
  return { verified, total: statements.length, tainted };
}

async function verify(ctx: PipelineCtx, iv: InterviewRow) {
  const r = await verifyInterview(ctx, iv.id);
  return { note: `${r.verified}/${r.total} quotes verified${r.tainted ? ` · ${r.tainted} tainted` : ""}` };
}

/* ------------------------------------------------------------------ score + synthesize */

export async function loadEvidence(ctx: PipelineCtx) {
  const [iv, st] = await Promise.all([
    ctx.supabase.from("interviews").select("id,label,position").eq("project_id", ctx.project.id).order("position", { ascending: true }),
    ctx.supabase.from("statements").select("*").eq("project_id", ctx.project.id),
  ]);
  return {
    interviews: must(iv, "load interviews") as { id: string; label: string; position: number }[],
    statements: must(st, "load statements") as StatementRow[],
  };
}

export async function scoreProject(ctx: PipelineCtx) {
  const { interviews, statements } = await loadEvidence(ctx);
  return computeScore(statements, interviews);
}

async function score(ctx: PipelineCtx) {
  const s = await scoreProject(ctx);
  must(await ctx.supabase.from("syntheses").upsert({ project_id: ctx.project.id, score: s }, { onConflict: "project_id" }).select("id"), "save score");
  return { note: s.headline };
}

export function rankCandidates(statements: StatementRow[], stance: "supports" | "contradicts", n = 6): StatementRow[] {
  return statements
    .filter((s) => s.verified && s.stance === stance && statementWeight(s.type, s.tainted) > 0)
    .sort((a, b) => statementWeight(b.type, b.tainted) - statementWeight(a.type, a.tainted) || Number(a.tainted) - Number(b.tainted) || a.turn_idx - b.turn_idx)
    .slice(0, n);
}

async function synthesize(ctx: PipelineCtx) {
  const { interviews, statements } = await loadEvidence(ctx);
  const labelOf = new Map(interviews.map((i) => [i.id, i.label]));
  const sc = computeScore(statements, interviews);
  const candFor = rankCandidates(statements, "supports");
  const candAgainst = rankCandidates(statements, "contradicts");
  const verified = statements.filter((s) => s.verified && s.type !== "irrelevant");
  const picked = new Map<string, StatementRow>();
  for (const s of [...candFor, ...candAgainst]) picked.set(s.id, s);
  for (const s of [...verified].sort((a, b) => statementWeight(b.type, b.tainted) - statementWeight(a.type, a.tainted))) {
    if (picked.size >= 60) break;
    picked.set(s.id, s);
  }
  const items = [...picked.values()].map((s) => ({
    id: s.id,
    interview: labelOf.get(s.interview_id) ?? "?",
    type: s.type,
    stance: s.stance,
    weight: statementWeight(s.type, s.tainted),
    tainted: s.tainted,
    quote: s.quote.length > 220 ? s.quote.slice(0, 220) + "…" : s.quote,
  }));

  let result: { themes: SynthesisRow["themes"]; top_for: SynthesisRow["top_for"]; top_against: SynthesisRow["top_against"]; open_questions: string[] };
  if (verified.length === 0) {
    result = { themes: [{ title: "No verified evidence", summary: "No statements in these interviews could be verified against the transcripts.", statement_ids: [] }], top_for: [], top_against: [], open_questions: ["Do the transcripts contain enough detail about the problem and how it is handled today?"] };
  } else {
    const llm = ctx.llmFor("synthesize");
    const res = await llm.json({
      step: "synthesize",
      task: "synthesize",
      system: SYNTHESIS_SYSTEM,
      user: buildSynthesisUser({ hypothesis: ctx.project.hypothesis, targetCustomer: ctx.project.target_customer, items, candidatesFor: candFor.map((s) => s.id), candidatesAgainst: candAgainst.map((s) => s.id) }),
      schema: synthesisOutputSchema,
      payload: { items, candidatesFor: candFor.map((s) => s.id), candidatesAgainst: candAgainst.map((s) => s.id) },
      maxTokens: 2500,
    });
    const validIds = new Set(verified.map((s) => s.id));
    const pick = (llmPicks: { statement_id: string; why: string }[], cands: StatementRow[]) => {
      const allowed = new Set(cands.map((c) => c.id));
      const out: { statement_id: string; why: string }[] = [];
      for (const p of llmPicks) if (allowed.has(p.statement_id) && !out.some((o) => o.statement_id === p.statement_id)) out.push(p);
      // code backfills with the highest-ranked candidates if the model picked invalid/too few ids
      for (const c of cands) {
        if (out.length >= Math.min(3, cands.length)) break;
        if (!out.some((o) => o.statement_id === c.id)) out.push({ statement_id: c.id, why: c.rationale });
      }
      return out.slice(0, 3);
    };
    result = {
      themes: res.data.themes.map((t) => ({ ...t, statement_ids: t.statement_ids.filter((id) => validIds.has(id)) })),
      top_for: pick(res.data.top_for, candFor),
      top_against: pick(res.data.top_against, candAgainst),
      open_questions: res.data.open_questions,
    };
  }
  must(
    await ctx.supabase
      .from("syntheses")
      .upsert({ project_id: ctx.project.id, ...result, score: sc, prompt_versions: PROMPT_VERSIONS }, { onConflict: "project_id" })
      .select("id"),
    "save synthesis",
  );
  return { note: `${result.top_for.length} for · ${result.top_against.length} against` };
}

/* ------------------------------------------------------------------ dispatcher */

export async function runStep(ctx: PipelineCtx, row: PipelineStepRow): Promise<{ status: "done" | "blocked"; note: string }> {
  const iv = row.interview_id ? await getInterview(ctx, row.interview_id) : null;
  try {
    let r: { note: string };
    switch (row.step) {
      case "transcribe": r = await transcribe(ctx, iv!); break;
      case "normalize": r = await normalize(ctx, iv!); break;
      case "classify": r = await classify(ctx, iv!); break;
      case "leading": r = await leading(ctx, iv!); break;
      case "verify": r = await verify(ctx, iv!); break;
      case "score": r = await score(ctx); break;
      case "synthesize": r = await synthesize(ctx); break;
    }
    return { status: "done", note: r.note };
  } catch (e) {
    if (e instanceof StepBlocked) return { status: "blocked", note: e.message };
    throw e;
  }
}

export { strengthOf };

export { normalize as normalizeInterview };

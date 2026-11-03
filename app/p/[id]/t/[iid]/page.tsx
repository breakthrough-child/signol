"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PageError, Spinner } from "@/components/loading";
import { Badge } from "@/components/ui/badge";
import type { InterviewRow, LeadingQuestionRow, StatementRow, TurnRow } from "@/lib/db-types";
import { useSession } from "@/lib/client/hooks";
import { findQuote } from "@/lib/text/match";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export default function TranscriptPage() {
  return (
    <Suspense fallback={<Spinner label="Loading transcript" />}>
      <Transcript />
    </Suspense>
  );
}

function Transcript() {
  const { id, iid } = useParams<{ id: string; iid: string }>();
  const selected = useSearchParams().get("s");
  const session = useSession();
  const [iv, setIv] = useState<InterviewRow | null>(null);
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [lqs, setLqs] = useState<LeadingQuestionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!session.ready) return;
    const sb = supabaseBrowser();
    Promise.all([
      sb.from("interviews").select("*").eq("id", iid).maybeSingle(),
      sb.from("turns").select("*").eq("interview_id", iid).order("idx", { ascending: true }),
      sb.from("statements").select("*").eq("interview_id", iid),
      sb.from("leading_questions").select("*").eq("interview_id", iid),
    ]).then(([a, b, c, d]) => {
      if (a.error || !a.data) return setError("Transcript not found.");
      setIv(a.data as InterviewRow);
      setTurns((b.data ?? []) as TurnRow[]);
      setStatements((c.data ?? []) as StatementRow[]);
      setLqs((d.data ?? []) as LeadingQuestionRow[]);
    });
  }, [session.ready, iid]);

  useEffect(() => {
    if (!turns.length) return;
    const hash = window.location.hash;
    if (hash) document.querySelector(hash)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [turns]);

  const byTurn = useMemo(() => {
    const m = new Map<number, StatementRow[]>();
    for (const s of statements.filter((x) => x.verified)) m.set(s.turn_idx, [...(m.get(s.turn_idx) ?? []), s]);
    return m;
  }, [statements]);
  const lqByTurn = useMemo(() => new Map(lqs.filter((l) => l.verified).map((l) => [l.turn_idx, l])), [lqs]);

  if (error) return <PageError message={error} />;
  if (!iv) return <Spinner label="Loading transcript" />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/p/${id}/board`} className="text-sm font-semibold text-signal underline">
        ← Back to the evidence board
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold">{iv.label}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink2">
        <span>{iv.word_count.toLocaleString()} words</span>
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Highlight every extracted quote
        </label>
      </div>

      <ol className="mt-5 space-y-3">
        {(turns.length ? turns : [{ id: "raw", idx: 0, speaker: "Transcript", role: "interviewee" as const, text: iv.raw_text ?? "", interview_id: iv.id }]).map((t) => (
          <li key={t.id} id={`turn-${t.idx}`} className={cn("scroll-mt-24 rounded-lg border p-3", t.role === "interviewer" ? "border-line bg-paper2/60" : "border-line bg-card")}>
            <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink2">
              {t.speaker}
              <Badge>{t.role}</Badge>
              {lqByTurn.get(t.idx) && <Badge tone="warn">leading question</Badge>}
            </p>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{renderTurn(t.text, byTurn.get(t.idx) ?? [], selected, showAll, lqByTurn.get(t.idx)?.question)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function renderTurn(text: string, statements: StatementRow[], selected: string | null, showAll: boolean, leadingQuestion?: string) {
  type Range = { start: number; end: number; kind: "sel" | "all" | "lead" };
  const ranges: Range[] = [];
  for (const s of statements) {
    const isSel = s.id === selected;
    if (!isSel && !showAll) continue;
    const start = s.quote_start ?? findQuote(s.quote, text).start;
    const end = s.quote_end ?? findQuote(s.quote, text).end;
    if (end > start) ranges.push({ start, end, kind: isSel ? "sel" : "all" });
  }
  if (leadingQuestion) {
    const m = findQuote(leadingQuestion, text);
    if (m.matched) ranges.push({ start: m.start, end: m.end, kind: "lead" });
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.start < pos) return;
    out.push(text.slice(pos, r.start));
    out.push(
      <mark key={i} className={cn("quote-hl", r.kind === "all" && "opacity-70", r.kind === "lead" && "!bg-warnsoft !border-warn")} id={r.kind === "sel" ? "selected-quote" : undefined}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    pos = r.end;
  });
  out.push(text.slice(pos));
  return out;
}

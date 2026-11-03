"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, ChevronDown } from "lucide-react";
import { EvidenceCard } from "@/components/evidence";
import { PageError, Spinner } from "@/components/loading";
import { ProjectNav } from "@/components/project-nav";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBoard } from "@/lib/client/board";
import type { ScoreResult } from "@/lib/scoring";
import { statementWeight } from "@/lib/scoring";
import { STANCES, STATEMENT_TYPES, TYPE_LABELS, type Stance, type StatementType } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const { project, interviews, statements, leading, synthesis, ready, error, boardError, loading } = useBoard(id);
  const [types, setTypes] = useState<StatementType[]>([]);
  const [stance, setStance] = useState<Stance | "all">("all");
  const [interview, setInterview] = useState<string>("all");
  const [showUnverified, setShowUnverified] = useState(false);
  const [limitFor, setLimitFor] = useState(8);
  const [limitAgainst, setLimitAgainst] = useState(8);
  const visibleMs = useRef(0);

  // time on the evidence board (visible time only), sent when the user leaves
  useEffect(() => {
    if (!project || (project.status !== "analyzed" && project.status !== "decided")) return;
    let since: number | null = document.visibilityState === "visible" ? Date.now() : null;
    const pause = () => {
      if (since) visibleMs.current += Date.now() - since;
      since = null;
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") pause();
      else since = Date.now();
    };
    const flush = () => {
      pause();
      const seconds = visibleMs.current / 1000;
      visibleMs.current = 0;
      if (seconds >= 1) navigator.sendBeacon(`/api/projects/${id}/timing`, new Blob([JSON.stringify({ seconds })], { type: "application/json" }));
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [project, id]);

  const label = useMemo(() => new Map(interviews.map((i) => [i.id, i.label])), [interviews]);
  const score = (synthesis?.score ?? null) as ScoreResult | null;
  const topIds = useMemo(() => new Map<string, number>([...(synthesis?.top_for ?? []), ...(synthesis?.top_against ?? [])].map((p) => [p.statement_id, 0])), [synthesis]);
  const whyOf = useMemo(() => new Map([...(synthesis?.top_for ?? []), ...(synthesis?.top_against ?? [])].map((p) => [p.statement_id, p.why])), [synthesis]);
  const rankOf = useMemo(() => {
    const m = new Map<string, number>();
    synthesis?.top_for.forEach((p, i) => m.set(p.statement_id, i + 1));
    synthesis?.top_against.forEach((p, i) => m.set(p.statement_id, i + 1));
    return m;
  }, [synthesis]);
  void topIds;

  if (error || boardError) return <PageError message={(error || boardError)!} />;
  if (loading || !project || !ready) return <Spinner label="Loading the evidence board" />;
  if (project.status !== "analyzed" && project.status !== "decided") {
    return (
      <div>
        <ProjectNav project={project} current="board" />
        <Alert tone="info">The evidence board appears once the analysis finishes. <Link className="font-semibold underline" href={`/p/${id}/analyze`}>Go to the analysis</Link>.</Alert>
      </div>
    );
  }

  const verified = statements.filter((s) => s.verified);
  const unverified = statements.filter((s) => !s.verified);
  const filtered = verified.filter((s) => (types.length ? types.includes(s.type) : true) && (stance === "all" ? true : s.stance === stance) && (interview === "all" ? true : s.interview_id === interview));
  const byWeight = (a: (typeof statements)[number], b: (typeof statements)[number]) => statementWeight(b.type, b.tainted) - statementWeight(a.type, a.tainted) || a.turn_idx - b.turn_idx;
  const supports = filtered.filter((s) => s.stance === "supports").sort(byWeight);
  const against = filtered.filter((s) => s.stance === "contradicts").sort(byWeight);
  const neutral = filtered.filter((s) => s.stance === "neutral").sort(byWeight);
  const verifiedLq = leading.filter((l) => l.verified);
  const toggleType = (t: StatementType) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const card = (s: (typeof statements)[number]) => (
    <EvidenceCard key={s.id} statement={s} interviewLabel={label.get(s.interview_id) ?? ""} projectId={id} rank={rankOf.get(s.id)} why={whyOf.get(s.id)} />
  );

  return (
    <div>
      <ProjectNav project={project} current="board" />

      {project.analysis_source === "cached" && (
        <Alert tone="signal" className="mb-4" title="Cached demo analysis">
          This is a pre-computed analysis of the demo interviews, not a live model run. Every quote below was still verified against the transcripts by code.
        </Alert>
      )}

      <section aria-label="Headline result" className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <Card className="border-signal/40 bg-signalsoft/40">
          <CardContent className="pt-6">
            <p className="font-display text-5xl font-semibold leading-none text-signal sm:text-6xl" data-testid="headline-pct">
              {score?.positiveSounding.total ? `${score.positiveSounding.pctNotEvidence}%` : "—"}
            </p>
            <p className="mt-3 font-display text-xl leading-snug" data-testid="headline">{score?.headline}</p>
            {score && score.positiveSounding.total > 0 && (
              <p className="mt-2 text-sm text-ink2">
                Of {score.positiveSounding.total} positive-sounding statements: {score.positiveSounding.compliments} compliments, {score.positiveSounding.promises} future promises, {score.positiveSounding.other} backed by behavior or a real pain.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-2 gap-3 pt-5 text-center">
            <Stat n={score?.strongFor ?? 0} label="strong evidence for" tone="support" />
            <Stat n={score?.strongAgainst ?? 0} label="strong evidence against" tone="against" />
            <Stat n={score?.tainted ?? 0} label="tainted answers" tone="warn" />
            <div className="rounded-lg bg-supportsoft p-3 text-support" data-testid="verified-badge">
              <BadgeCheck className="mx-auto" size={22} aria-hidden="true" />
              <b className="block text-lg">
                {verified.length}/{statements.length}
              </b>
              <span className="text-xs font-semibold">quotes verified</span>
            </div>
          </CardContent>
        </Card>
      </section>
      <p className="mt-2 text-xs text-ink2">
        Quotes are checked by code against the source transcripts (not by the AI). Unverifiable quotes are excluded from all numbers. Strong evidence = untainted past behavior or a specific current pain.
      </p>

      {synthesis && (
        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Themes and open questions">
          <Card>
            <CardHeader>
              <CardTitle>Key themes</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {synthesis.themes.map((t) => (
                  <li key={t.title}>
                    <p className="font-semibold">{t.title}</p>
                    <p className="text-sm text-ink2">{t.summary}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Open questions</CardTitle>
              <CardDescription>What you still do not know.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm">
                {synthesis.open_questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      <section className="mt-8" aria-label="Filters">
        <h2 className="font-display text-2xl font-semibold">Evidence</h2>
        <div className="mt-3 space-y-3 rounded-xl border border-line bg-card p-4">
          <fieldset>
            <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-ink2">Type</legend>
            <div className="flex flex-wrap gap-2">
              {STATEMENT_TYPES.filter((t) => t !== "irrelevant").map((t) => (
                <button key={t} type="button" aria-pressed={types.includes(t)} onClick={() => toggleType(t)} className={cn("min-h-9 rounded-full border px-3 text-sm font-semibold", types.includes(t) ? "border-ink bg-ink text-paper" : "border-line bg-paper2 hover:bg-paper")}>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="f-stance" className="mb-1 block text-xs font-bold uppercase tracking-wider text-ink2">Stance</label>
              <select id="f-stance" value={stance} onChange={(e) => setStance(e.target.value as Stance | "all")} className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm">
                <option value="all">All</option>
                {STANCES.map((s) => (
                  <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-iv" className="mb-1 block text-xs font-bold uppercase tracking-wider text-ink2">Interview</label>
              <select id="f-iv" value={interview} onChange={(e) => setInterview(e.target.value)} className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm">
                <option value="all">All interviews</option>
                {interviews.map((i) => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-ink2" role="status">
            Showing {filtered.length} of {verified.length} verified statements.
            {(types.length > 0 || stance !== "all" || interview !== "all") && (
              <button className="ml-2 font-semibold text-signal underline" onClick={() => { setTypes([]); setStance("all"); setInterview("all"); }}>
                Clear filters
              </button>
            )}
          </p>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div data-testid="col-for">
            <h3 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold text-support">
              Supports the hypothesis <Badge tone="support">{supports.length}</Badge>
            </h3>
            <div className="space-y-3">
              {supports.slice(0, limitFor).map(card)}
              {supports.length > limitFor && <button className="w-full rounded-lg border border-line bg-card py-3 text-sm font-semibold hover:bg-paper2" onClick={() => setLimitFor(limitFor + 8)}>Show {Math.min(8, supports.length - limitFor)} more ({supports.length - limitFor} left)</button>}
              {supports.length === 0 && <p className="rounded-lg border border-dashed border-line p-4 text-sm text-ink2">Nothing matches here.</p>}
            </div>
          </div>
          <div data-testid="col-against">
            <h3 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold text-against">
              Contradicts the hypothesis <Badge tone="against">{against.length}</Badge>
            </h3>
            <div className="space-y-3">
              {against.slice(0, limitAgainst).map(card)}
              {against.length > limitAgainst && <button className="w-full rounded-lg border border-line bg-card py-3 text-sm font-semibold hover:bg-paper2" onClick={() => setLimitAgainst(limitAgainst + 8)}>Show {Math.min(8, against.length - limitAgainst)} more ({against.length - limitAgainst} left)</button>}
              {against.length === 0 && <p className="rounded-lg border border-dashed border-line p-4 text-sm text-ink2">Nothing matches here.</p>}
            </div>
          </div>
        </div>

        {neutral.length > 0 && (
          <details className="mt-6 rounded-xl border border-line bg-card p-4">
            <summary className="flex cursor-pointer items-center gap-2 font-semibold">
              <ChevronDown size={16} aria-hidden="true" /> Neutral statements and noise ({neutral.length})
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">{neutral.slice(0, 12).map(card)}</div>
          </details>
        )}
      </section>

      <section className="mt-10" aria-labelledby="lq-h">
        <h2 id="lq-h" className="font-display text-2xl font-semibold">
          Leading questions <Badge tone="warn">{verifiedLq.length}</Badge>
        </h2>
        <p className="mt-1 text-sm text-ink2">Questions you asked that nudge the answer. Answers that followed them are marked tainted and count for less.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {verifiedLq.map((l) => (
            <Card key={l.id} data-testid="leading-card">
              <CardContent className="space-y-2 pt-5">
                <p className="text-xs font-semibold text-ink2">{label.get(l.interview_id)}</p>
                <blockquote className="font-display text-[17px] leading-snug">&ldquo;{l.question}&rdquo;</blockquote>
                <p className="text-sm"><b>Why it leads:</b> {l.why_leading}</p>
                <p className="rounded-lg bg-supportsoft p-3 text-sm text-support"><b>Neutral rewrite:</b> {l.neutral_rewrite}</p>
                <p className="text-xs text-ink2">
                  Tainted {statements.filter((s) => s.tainted_by === l.id).length} statement(s).{" "}
                  <Link className="font-semibold text-signal underline" href={`/p/${id}/t/${l.interview_id}#turn-${l.turn_idx}`}>View in transcript</Link>
                </p>
              </CardContent>
            </Card>
          ))}
          {verifiedLq.length === 0 && <p className="text-sm text-ink2">No leading questions were found.</p>}
        </div>
      </section>

      {unverified.length > 0 && (
        <section className="mt-8">
          <button className="text-sm font-semibold underline" onClick={() => setShowUnverified((v) => !v)} aria-expanded={showUnverified}>
            {unverified.length} statement(s) excluded because the quote could not be verified in the transcript
          </button>
          {showUnverified && (
            <ul className="mt-2 space-y-2 text-sm text-ink2">
              {unverified.map((u) => (
                <li key={u.id} className="rounded-lg border border-dashed border-line p-3">
                  &ldquo;{u.quote}&rdquo; <span className="text-xs">({label.get(u.interview_id)}, not found in transcript)</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3 rounded-xl border border-ink bg-card p-5">
        <div className="flex-1">
          <p className="font-display text-lg font-semibold">{project.status === "decided" ? "You have recorded your decision." : "Ready to decide?"}</p>
          <p className="text-sm text-ink2">
            {project.status === "decided" ? "See the calibration of your prediction and your outputs." : "Checkpoint 2: you will read the strongest counter-evidence and respond in your own words before choosing."}
          </p>
        </div>
        <Link href={`/p/${id}/decide`} className={cn(buttonVariants({ size: "lg" }))} data-testid="to-decide">
          {project.status === "decided" ? "See calibration" : "Go to the decision"}
        </Link>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "support" | "against" | "warn" }) {
  const cls = tone === "support" ? "bg-supportsoft text-support" : tone === "against" ? "bg-againstsoft text-against" : "bg-warnsoft text-warn";
  return (
    <div className={cn("rounded-lg p-3", cls)}>
      <b className="block text-3xl font-semibold leading-none">{n}</b>
      <span className="text-xs font-semibold">{label}</span>
    </div>
  );
}

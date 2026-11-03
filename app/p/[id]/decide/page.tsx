"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { PageError, Spinner } from "@/components/loading";
import { ProjectNav } from "@/components/project-nav";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Hint, Textarea } from "@/components/ui/form";
import { StanceTag, StrengthMeter, TypeBadge } from "@/components/evidence";
import { api } from "@/lib/client/api";
import { useBoard } from "@/lib/client/board";
import type { DecisionRow } from "@/lib/db-types";
import { CHOICE_LABELS, checkFriction, isRealResponse, type Choice } from "@/lib/decision";
import type { ScoreResult } from "@/lib/scoring";
import { statementWeight } from "@/lib/scoring";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const CHOICES: { key: Choice; title: string; blurb: string }[] = [
  { key: "validated", title: "Validated", blurb: "The evidence supports the hypothesis. You must first answer the strongest counter-evidence." },
  { key: "invalidated", title: "Invalidated", blurb: "The evidence contradicts the hypothesis. You must first answer the strongest supporting evidence." },
  { key: "need_more_evidence", title: "Need more evidence", blurb: "Not enough to call it. No extra step; you will get a better next-interview script." },
];

export default function DecidePage() {
  const { id } = useParams<{ id: string }>();
  const { project, interviews, statements, synthesis, ready, error, boardError, loading, reload } = useBoard(id);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionRow | null>(null);

  useEffect(() => {
    if (project?.status === "decided") {
      supabaseBrowser().from("decisions").select("*").eq("project_id", id).maybeSingle().then(({ data }) => setDecision(data as DecisionRow | null));
    }
  }, [project?.status, id]);

  const byId = useMemo(() => new Map(statements.map((s) => [s.id, s])), [statements]);
  const label = useMemo(() => new Map(interviews.map((i) => [i.id, i.label])), [interviews]);

  if (error || boardError) return <PageError message={(error || boardError)!} />;
  if (loading || !project || !ready) return <Spinner label="Loading" />;
  if (project.status !== "analyzed" && project.status !== "decided") {
    return (
      <div>
        <ProjectNav project={project} current="decide" />
        <Alert tone="info">The decision unlocks when the analysis is finished. <Link className="font-semibold underline" href={`/p/${id}/analyze`}>Go to the analysis</Link>.</Alert>
      </div>
    );
  }
  if (!synthesis) return <PageError message="The analysis result is missing. Re-run the analysis." />;

  const forIds = synthesis.top_for.map((p) => p.statement_id);
  const againstIds = synthesis.top_against.map((p) => p.statement_id);
  const required = choice === "validated" ? againstIds : choice === "invalidated" ? forIds : [];
  const friction = choice ? checkFriction(choice, forIds, againstIds, Object.entries(responses).map(([statement_id, response]) => ({ statement_id, response }))) : null;
  const allOpened = required.every((rid) => opened[rid]);
  const can = Boolean(choice) && friction?.ok && allOpened;
  const score = synthesis.score as ScoreResult;

  async function submit() {
    if (!choice) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { choice, responses: required.map((rid) => ({ statement_id: rid, response: responses[rid] ?? "" })) };
      await api(`/api/projects/${id}/decision`, { method: "POST", json: body });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (project.status === "decided") {
    return (
      <div>
        <ProjectNav project={project} current="decide" />
        <Calibration decision={decision} score={score} total={interviews.length} />
        <div className="mt-6">
          <Link href={`/p/${id}/outputs`} className={cn(buttonVariants({ size: "lg" }))} data-testid="to-outputs">
            Decision log and next interview script
          </Link>
        </div>
      </div>
    );
  }

  const requiredCards = required.map((rid) => ({ rid, s: byId.get(rid), why: [...synthesis.top_for, ...synthesis.top_against].find((p) => p.statement_id === rid)?.why }));

  return (
    <div>
      <ProjectNav project={project} current="decide" />
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-signal">Checkpoint 2 of 2</p>
        <h2 className="font-display text-3xl font-semibold">Your decision</h2>
        <p className="mt-2 text-ink2">signol will not tell you whether your idea is good. You decide. But to say &ldquo;validated&rdquo; or &ldquo;invalidated&rdquo;, you first answer the strongest evidence on the other side. This is the step that stops confirmation bias.</p>

        <fieldset className="mt-6">
          <legend className="mb-2 font-semibold">What is your call?</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {CHOICES.map((c) => (
              <label key={c.key} className={cn("flex min-h-28 cursor-pointer flex-col rounded-xl border-2 p-4", choice === c.key ? "border-ink bg-card" : "border-line bg-card hover:bg-paper2")}>
                <input type="radio" name="choice" value={c.key} className="sr-only" checked={choice === c.key} onChange={() => setChoice(c.key)} data-testid={`choice-${c.key}`} />
                <span className="font-display text-lg font-semibold">{c.title}</span>
                <span className="mt-1 text-sm text-ink2">{c.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {choice && required.length > 0 && (
          <section className="mt-6" aria-label="Respond to the evidence">
            <Alert tone="warn" title={choice === "validated" ? "Before you can choose Validated: face the strongest counter-evidence" : "Before you can choose Invalidated: face the strongest supporting evidence"}>
              Open each card, then write at least one sentence in your own words: why does this not change your mind, or does it? There are no wrong answers, but you cannot skip them.
            </Alert>
            <div className="mt-4 space-y-3">
              {requiredCards.map(({ rid, s, why }, i) =>
                s ? (
                  <details key={rid} className="rounded-xl border border-line bg-card" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpened((o) => ({ ...o, [rid]: true }))} data-testid="friction-card">
                    <summary className="flex min-h-14 cursor-pointer items-center gap-3 p-4">
                      <Badge tone={isRealResponse(responses[rid]) ? "support" : "warn"}>
                        {isRealResponse(responses[rid]) ? <><Check size={12} aria-hidden="true" /> answered</> : opened[rid] ? "needs your response" : "open me"}
                      </Badge>
                      <span className="font-semibold">
                        {choice === "validated" ? "Counter-evidence" : "Supporting evidence"} {i + 1} · {label.get(s.interview_id)}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-line p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <StanceTag stance={s.stance} />
                        <TypeBadge type={s.type} />
                        <StrengthMeter weight={statementWeight(s.type, s.tainted)} />
                      </div>
                      <blockquote className="font-display text-lg leading-snug">&ldquo;{s.quote}&rdquo;</blockquote>
                      {why && <p className="text-sm text-ink2">{why}</p>}
                      <Link className="text-sm font-semibold text-signal underline" href={`/p/${id}/t/${s.interview_id}?s=${s.id}#turn-${s.turn_idx}`} target="_blank">
                        Read it in the transcript (new tab)
                      </Link>
                      <div>
                        <label htmlFor={`r-${rid}`} className="mb-1 block text-sm font-semibold">Your response</label>
                        <Textarea id={`r-${rid}`} rows={3} value={responses[rid] ?? ""} onChange={(e) => setResponses((r) => ({ ...r, [rid]: e.target.value }))} placeholder="In one or two sentences: what does this tell you, and does it change your view?" data-testid="friction-response" />
                        <Hint>At least one sentence.</Hint>
                      </div>
                    </div>
                  </details>
                ) : null,
              )}
              {requiredCards.length === 0 && <Alert tone="info">There are no cards on this side, so nothing to respond to.</Alert>}
            </div>
          </section>
        )}

        {err && <Alert tone="error" className="mt-4">{err}</Alert>}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="lg" variant="ink" disabled={!can || busy} onClick={submit} data-testid="submit-decision">
            {busy ? "Recording…" : choice ? `Record decision: ${CHOICE_LABELS[choice]}` : "Choose an option"}
          </Button>
          {choice && !can && required.length > 0 && (
            <span className="text-sm text-ink2" role="status">
              {!allOpened ? "Open every card" : "Respond to every card"} to continue ({required.filter((r) => opened[r] && isRealResponse(responses[r])).length}/{required.length}).
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Calibration({ decision, score, total }: { decision: DecisionRow | null; score: ScoreResult; total: number }) {
  if (!decision) return <Spinner label="Loading your calibration" />;
  const c = decision.calibration;
  return (
    <section aria-label="Calibration" data-testid="calibration">
      <Alert tone="ok" title={`Decision recorded: ${CHOICE_LABELS[decision.choice]}`}>
        Saved {new Date(decision.decided_at).toLocaleString()}. Now compare what you expected with what the interviews showed.
      </Alert>
      <h2 className="mt-6 font-display text-2xl font-semibold">Calibration: your prediction vs the evidence</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>What you predicted before analysis</CardDescription>
            <CardTitle className="text-4xl text-signal">{c.predictedSupporters} <span className="text-lg text-ink2">of {c.interviewCount}</span></CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">at <b>{c.confidence}%</b> confidence</p>
            <Bar value={c.predictedSupporters} total={c.interviewCount} className="bg-signal" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>What the evidence shows</CardDescription>
            <CardTitle className="text-4xl">{c.actualSupporters} <span className="text-lg text-ink2">of {c.interviewCount}</span></CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">interviewees with strong supporting evidence</p>
            <Bar value={c.actualSupporters} total={c.interviewCount} className="bg-ink" />
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4">
        <CardContent className="pt-5">
          <p className="leading-relaxed" data-testid="reflection">{c.reflection}</p>
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Interview by interview</CardTitle>
          <CardDescription>&ldquo;Supports&rdquo; means strong, untainted supporting statements outnumber strong counter-statements.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-ink2">
                <tr><th className="py-2 pr-3">Interview</th><th className="pr-3">Strong for</th><th className="pr-3">Strong against</th><th>Result</th></tr>
              </thead>
              <tbody>
                {score.perInterview.map((p) => (
                  <tr key={p.interviewId} className="border-t border-line">
                    <td className="py-2 pr-3">{p.label}</td>
                    <td className="pr-3 font-mono">{p.strongFor}</td>
                    <td className="pr-3 font-mono">{p.strongAgainst}</td>
                    <td>{p.supports ? <Badge tone="support">supports</Badge> : <Badge>not clearly</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink2">{total} interviews in total.</p>
        </CardContent>
      </Card>
    </section>
  );
}

function Bar({ value, total, className }: { value: number; total: number; className: string }) {
  return (
    <div className="mt-2 flex gap-1" aria-hidden="true">
      {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
        <span key={i} className={cn("h-3 flex-1 rounded-sm", i < value ? className : "bg-line")} />
      ))}
    </div>
  );
}

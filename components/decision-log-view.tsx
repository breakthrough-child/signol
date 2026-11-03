import { BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHOICE_LABELS, type DecisionLog, type LogEvidence } from "@/lib/decision";
import { TYPE_LABELS } from "@/lib/types";

function Ev({ e }: { e: LogEvidence }) {
  return (
    <li className="rounded-lg border border-line bg-card p-3">
      <blockquote className="font-display text-[16px] leading-snug">&ldquo;{e.quote}&rdquo;</blockquote>
      <p className="mt-1 text-xs text-ink2">
        {e.interview} · {TYPE_LABELS[e.type]} · {e.strength}
        {e.tainted ? " · tainted by a leading question" : ""}
      </p>
      <p className="mt-1 text-sm">{e.why}</p>
    </li>
  );
}

/** Read-only rendering of a frozen decision log. Used on the outputs page and the public share page. */
export function DecisionLogView({ log }: { log: DecisionLog }) {
  const s = log.evidence.score;
  return (
    <article className="space-y-5" aria-label="Decision log" data-testid="decision-log">
      <header>
        <p className="text-xs font-bold uppercase tracking-wider text-ink2">Decision log</p>
        <h2 className="font-display text-3xl font-semibold leading-tight">{log.project.name}</h2>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="ink">{CHOICE_LABELS[log.choice]}</Badge>
          <span className="text-sm text-ink2">{new Date(log.decidedAt).toLocaleString()}</span>
          {log.analysis.source === "cached" && <Badge tone="signal">cached demo analysis</Badge>}
          <Badge tone="support">
            <BadgeCheck size={12} aria-hidden="true" /> {log.analysis.quotesVerified}/{log.analysis.quotesTotal} quotes verified
          </Badge>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Hypothesis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p>{log.project.hypothesis}</p>
          <p className="text-sm text-ink2">Target customer: {log.project.target_customer}</p>
          <p className="pt-2 text-sm">
            <b>Pre-committed prediction:</b> {log.prediction.supporters} of {log.analysis.interviews} interviewees would support it, at {log.prediction.confidence}% confidence.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the evidence showed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-display text-xl leading-snug">{log.evidence.headline}</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            <li>Strong evidence for: <b>{s.strongFor}</b></li>
            <li>Strong evidence against: <b>{s.strongAgainst}</b></li>
            <li>Answers tainted by leading questions: <b>{s.tainted}</b></li>
            <li>Interviewees with strong support: <b>{s.supporters}</b> of {s.interviewCount}</li>
          </ul>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 font-semibold text-support">Strongest evidence for</h3>
              <ul className="space-y-2">{log.topFor.map((e) => <Ev key={e.id} e={e} />)}{!log.topFor.length && <li className="text-sm text-ink2">None found.</li>}</ul>
            </div>
            <div>
              <h3 className="mb-2 font-semibold text-against">Strongest evidence against</h3>
              <ul className="space-y-2">{log.topAgainst.map((e) => <Ev key={e.id} e={e} />)}{!log.topAgainst.length && <li className="text-sm text-ink2">None found.</li>}</ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The founder&apos;s responses to the evidence</CardTitle>
        </CardHeader>
        <CardContent>
          {log.responses.length === 0 && <p className="text-sm text-ink2">No responses were required for this decision.</p>}
          <ul className="space-y-3">
            {log.responses.map((r, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <p className="text-xs font-semibold text-ink2">{r.side === "against" ? "Counter-evidence" : "Supporting evidence"} · {r.interview}</p>
                <blockquote className="font-display text-[16px] leading-snug">&ldquo;{r.quote}&rdquo;</blockquote>
                <p className="mt-2 border-l-4 border-signal pl-3 text-sm">{r.response}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed">{log.calibration.reflection}</p>
        </CardContent>
      </Card>
    </article>
  );
}

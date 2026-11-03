"use client";

import { useEffect, useState } from "react";
import { PageError, Spinner } from "@/components/loading";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDuration } from "@/lib/client/hooks";
import { aggregate, groupRunLogs, normalizeRow, type Aggregate, type CallGroup, type RunLogLite } from "@/lib/stats";
import { ensureSession, supabaseBrowser } from "@/lib/supabase/browser";

export default function StatsPage() {
  const [mine, setMine] = useState<Aggregate | null>(null);
  const [all, setAll] = useState<Aggregate | null>(null);
  const [calls, setCalls] = useState<CallGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await ensureSession();
      const sb = supabaseBrowser();
      const [m, a, logs] = await Promise.all([
        sb.rpc("stats_rows", { p_all: false }),
        sb.rpc("stats_rows", { p_all: true }),
        sb.from("run_logs").select("step,provider,model,tokens_in,tokens_out,latency_ms,ok"),
      ]);
      if (m.error) throw new Error(m.error.message);
      if (a.error) throw new Error(a.error.message);
      setMine(aggregate(((m.data ?? []) as Record<string, unknown>[]).map(normalizeRow)));
      setAll(aggregate(((a.data ?? []) as Record<string, unknown>[]).map(normalizeRow)));
      setCalls(groupRunLogs((logs.data ?? []) as RunLogLite[]));
    })().catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <PageError message={error} />;
  if (!mine || !all) return <Spinner label="Loading stats" />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold">Time saved and model usage</h1>
        <p className="mt-2 max-w-2xl text-ink2">Every run is timed: analysis, time on the evidence board, and time to decision. Optionally record how long manual synthesis takes you (&ldquo;Benchmark mode&rdquo;) to see the difference. Numbers are computed from stored events, not estimated.</p>
      </div>
      <Block title="All runs on this deployment" subtitle="Pooled across every visitor. Counts and durations only, never content." a={all} />
      <Block title="Your runs in this browser session" subtitle="Only the projects you created." a={mine} />

      <Card>
        <CardHeader>
          <CardTitle>Your model calls</CardTitle>
          <CardDescription>Provider, model, tokens and latency per pipeline step. This feeds the AI disclosure statement.</CardDescription>
        </CardHeader>
        <CardContent>
          {calls.length === 0 ? (
            <p className="text-sm text-ink2">No model calls yet. Run the demo with the live model to see them.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs uppercase text-ink2">
                  <tr><th className="py-2 pr-3">Step</th><th className="pr-3">Provider</th><th className="pr-3">Model</th><th className="pr-3">Calls</th><th className="pr-3">Failed</th><th className="pr-3">Tokens in</th><th className="pr-3">Tokens out</th><th>Avg latency</th></tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={`${c.provider}|${c.model}|${c.step}`} className="border-t border-line">
                      <td className="py-2 pr-3">{c.step}</td><td className="pr-3">{c.provider}</td><td className="pr-3 font-mono text-xs">{c.model || "n/a"}</td>
                      <td className="pr-3 font-mono">{c.calls}</td><td className="pr-3 font-mono">{c.failed}</td>
                      <td className="pr-3 font-mono">{c.tokensIn.toLocaleString()}</td><td className="pr-3 font-mono">{c.tokensOut.toLocaleString()}</td>
                      <td className="font-mono">{c.avgLatencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Block({ title, subtitle, a }: { title: string; subtitle: string; a: Aggregate }) {
  const n = (v: number | null, f: (x: number) => string) => (v === null ? "n/a" : f(v));
  return (
    <section>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="text-sm text-ink2">{subtitle}</p>
      {a.runs === 0 ? (
        <Alert tone="info" className="mt-3">No completed analyses yet.</Alert>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Runs" value={`${a.runs}`} sub={`${a.liveRuns} live · ${a.cachedRuns} cached · ${a.decidedRuns} decided`} />
          <Tile label="Avg analysis time (live)" value={n(a.avgAnalysisSeconds, fmtDuration)} sub="from start to finished synthesis" />
          <Tile label="Avg time on evidence board" value={n(a.avgBoardSeconds, fmtDuration)} sub="visible-tab time" />
          <Tile label="Avg time to decision" value={n(a.avgTimeToDecisionSeconds, fmtDuration)} sub="start of analysis to decision" />
          <Tile label="Model calls per live run" value={n(a.avgCallsPerRun, (x) => x.toFixed(1))} sub={`${a.failedCalls} failed/retried calls overall`} />
          <Tile label="Tokens per live run" value={n(a.avgTokensInPerRun, (x) => Math.round(x + (a.avgTokensOutPerRun ?? 0)).toLocaleString())} sub={a.avgTokensInPerRun === null ? "" : `${Math.round(a.avgTokensInPerRun).toLocaleString()} in · ${Math.round(a.avgTokensOutPerRun ?? 0).toLocaleString()} out`} />
          {a.benchmark ? (
            <>
              <Tile label="Manual synthesis (benchmark)" value={`${Math.round(a.benchmark.avgManualMinutes)} min`} sub={`${a.benchmark.n} run(s) with a benchmark`} />
              <Tile label="Time saved" value={`${Math.round(a.benchmark.avgSavedMinutes)} min`} sub={`${a.benchmark.pctSaved}% less than manual`} highlight />
            </>
          ) : (
            <Tile label="Benchmark" value="n/a" sub="no run has a manual-time benchmark yet" />
          )}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-signal/50 bg-signalsoft/40" : ""}>
      <CardContent className="pt-5">
        <p className="text-xs font-bold uppercase tracking-wider text-ink2">{label}</p>
        <p className="mt-1 font-display text-3xl font-semibold">{value}</p>
        {sub && <p className="mt-1 text-xs text-ink2">{sub}</p>}
      </CardContent>
    </Card>
  );
}

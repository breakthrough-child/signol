"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { DecisionLogView } from "@/components/decision-log-view";
import { PageError, Spinner } from "@/components/loading";
import { ProjectNav } from "@/components/project-nav";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label } from "@/components/ui/form";
import { api } from "@/lib/client/api";
import { fmtDuration, useProject } from "@/lib/client/hooks";
import type { DecisionRow, ScriptDoc } from "@/lib/db-types";
import { projectTimes, type TimingEventLite } from "@/lib/stats";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export default function OutputsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { project, error, loading, reload } = useProject(id);
  const [decision, setDecision] = useState<DecisionRow | null>(null);
  const [script, setScript] = useState<ScriptDoc | null>(null);
  const [events, setEvents] = useState<TimingEventLite[]>([]);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!project) return;
    const sb = supabaseBrowser();
    sb.from("decisions").select("*").eq("project_id", id).maybeSingle().then(({ data }) => {
      const d = data as DecisionRow | null;
      setDecision(d);
      if (d?.share_token) setShareUrl(`${window.location.origin}/s/${d.share_token}`);
      setManual(project.benchmark_manual_minutes ? String(project.benchmark_manual_minutes) : "");
    });
    sb.from("syntheses").select("script").eq("project_id", id).maybeSingle().then(({ data }) => setScript((data as { script: ScriptDoc | null } | null)?.script ?? null));
    sb.from("timing_events").select("event,at,meta").eq("project_id", id).then(({ data }) => setEvents((data ?? []) as TimingEventLite[]));
  }, [project, id]);

  if (error) return <PageError message={error} />;
  if (loading || !project) return <Spinner label="Loading outputs" />;
  if (project.status !== "decided" || !decision) {
    return (
      <div>
        <ProjectNav project={project} current="outputs" />
        <Alert tone="info">Outputs are created when you record your decision. <Link className="font-semibold underline" href={`/p/${id}/decide`}>Go to the decision</Link>.</Alert>
      </div>
    );
  }

  const times = projectTimes(events);

  async function share() {
    setBusy("share");
    try {
      const { path } = await api<{ path: string }>(`/api/projects/${id}/share`, { method: "POST" });
      setShareUrl(`${window.location.origin}${path}`);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  async function unshare() {
    setBusy("unshare");
    await api(`/api/projects/${id}/share`, { method: "DELETE" }).catch(() => null);
    setShareUrl(null);
    setBusy(null);
  }
  async function genScript() {
    setBusy("script");
    setMsg(null);
    try {
      const r = await api<{ script: ScriptDoc }>(`/api/projects/${id}/script`, { method: "POST" });
      setScript(r.script);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  async function saveBenchmark() {
    setBusy("bench");
    try {
      const v = manual.trim() === "" ? null : Math.round(Number(manual));
      await api(`/api/projects/${id}`, { method: "PATCH", json: { benchmark_manual_minutes: v } });
      await reload();
      setMsg({ tone: "ok", text: "Benchmark saved." });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!window.confirm("Delete this project, its interviews and the decision log permanently? This cannot be undone.")) return;
    setBusy("delete");
    await api(`/api/projects/${id}`, { method: "DELETE" }).catch((e) => setMsg({ tone: "error", text: (e as Error).message }));
    router.push("/projects");
  }

  const dl = (doc: "log" | "script", format: "md" | "pdf", text: string) => (
    <a className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/api/projects/${id}/export?doc=${doc}&format=${format}`} download>
      <Download size={14} aria-hidden="true" /> {text}
    </a>
  );

  return (
    <div>
      <ProjectNav project={project} current="outputs" />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <DecisionLogView log={decision.log} />
        </div>

        <aside className="space-y-5" aria-label="Exports and tools">
          <Card>
            <CardHeader>
              <CardTitle>Export the decision log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {dl("log", "md", "Markdown")}
                {dl("log", "pdf", "PDF")}
              </div>
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-sm font-semibold">Read-only share link</p>
                {shareUrl ? (
                  <div className="space-y-2">
                    <Input readOnly value={shareUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} data-testid="share-url" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy</Button>
                      <Button size="sm" variant="ghost" onClick={unshare} disabled={busy === "unshare"}>Turn link off</Button>
                    </div>
                    <Hint>Anyone with this link can read the decision log only. Interviews stay private.</Hint>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={share} disabled={busy === "share"} data-testid="create-share">
                    <Share2 size={14} aria-hidden="true" /> Create share link
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Time saved</CardTitle>
              <CardDescription>Measured on this run.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <dt>Analysis ({project.analysis_source === "cached" ? "cached" : "live"})</dt><dd className="font-mono">{fmtDuration(times.analysisSeconds)}</dd>
                <dt>Time on the evidence board</dt><dd className="font-mono">{fmtDuration(times.boardSeconds)}</dd>
                <dt>Start of analysis to decision</dt><dd className="font-mono">{fmtDuration(times.timeToDecisionSeconds)}</dd>
                {project.benchmark_manual_minutes && (
                  <>
                    <dt>Your manual benchmark</dt><dd className="font-mono">{project.benchmark_manual_minutes}m</dd>
                  </>
                )}
              </dl>
              <div>
                <Label htmlFor="bench">Benchmark mode: minutes manual synthesis takes you</Label>
                <div className="flex gap-2">
                  <Input id="bench" type="number" min={1} max={6000} value={manual} onChange={(e) => setManual(e.target.value)} className="max-w-32" />
                  <Button size="sm" variant="outline" onClick={saveBenchmark} disabled={busy === "bench"}>Save</Button>
                </div>
              </div>
              <Link className="font-semibold text-signal underline" href="/stats">All runs and averages</Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your data</CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="danger" size="sm" onClick={remove} disabled={busy === "delete"}>Delete this project and its files</Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      <section className="mt-10" aria-labelledby="script-h">
        <h2 id="script-h" className="font-display text-2xl font-semibold">Next interview script</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink2">Your own questions with the leading ones rewritten neutrally, plus new questions aimed at what you still do not know. Customer-discovery rule: ask about the past, never about hypotheticals.</p>
        {!script ? (
          <Button className="mt-4" onClick={genScript} disabled={busy === "script"} data-testid="gen-script">
            {busy === "script" ? "Writing your script…" : "Generate the next interview script"}
          </Button>
        ) : (
          <div className="mt-4 space-y-5" data-testid="script">
            <div className="flex flex-wrap gap-2">
              {dl("script", "md", "Script (Markdown)")}
              {dl("script", "pdf", "Script (PDF)")}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader><CardTitle>Rewritten ({script.rewritten.length})</CardTitle><CardDescription>These were leading.</CardDescription></CardHeader>
                <CardContent>
                  <ol className="list-decimal space-y-3 pl-5 text-sm">
                    {script.rewritten.map((r, i) => (
                      <li key={i}>
                        <b>{r.rewrite}</b>
                        <span className="block text-xs text-ink2">Was: &ldquo;{r.original}&rdquo;</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Keep ({script.kept.length})</CardTitle><CardDescription>Neutral already.</CardDescription></CardHeader>
                <CardContent>
                  <ol className="list-decimal space-y-2 pl-5 text-sm">{script.kept.map((k, i) => <li key={i}>{k.question}</li>)}</ol>
                </CardContent>
              </Card>
              <Card className="border-signal/40">
                <CardHeader><CardTitle>New ({script.added.length})</CardTitle><CardDescription>Aimed at your open questions.</CardDescription></CardHeader>
                <CardContent>
                  <ol className="list-decimal space-y-3 pl-5 text-sm">
                    {script.added.map((a, i) => (
                      <li key={i}>
                        <b>{a.question}</b>
                        <span className="block text-xs text-ink2">Targets: {a.targets}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

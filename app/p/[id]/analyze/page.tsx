"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Circle, Loader2, PauseCircle } from "lucide-react";
import { PageError, Spinner } from "@/components/loading";
import { ProjectNav } from "@/components/project-nav";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InterviewRow, PipelineStepRow } from "@/lib/db-types";
import { api } from "@/lib/client/api";
import { fmtDuration, useProject } from "@/lib/client/hooks";
import { STEP_LABELS, STEP_ORDER } from "@/lib/pipeline/steps";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const orderIdx = (s: PipelineStepRow) => STEP_ORDER.indexOf(s.step);

export default function AnalyzePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { project, interviews, error, loading, reload } = useProject(id);
  const [steps, setSteps] = useState<PipelineStepRow[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef<number | null>(null);
  const loopRef = useRef(false);
  const interviewsRef = useRef<InterviewRow[]>([]);
  useEffect(() => {
    interviewsRef.current = interviews;
  }, [interviews]);

  const fetchSteps = useCallback(async () => {
    const { data } = await supabaseBrowser().from("pipeline_steps").select("*").eq("project_id", id);
    const rows = ((data ?? []) as PipelineStepRow[]).sort((a, b) => orderIdx(a) - orderIdx(b));
    setSteps(rows);
    return rows;
  }, [id]);

  // clock
  useEffect(() => {
    const t = setInterval(() => started.current && setElapsed((Date.now() - started.current) / 1000), 500);
    return () => clearInterval(t);
  }, []);

  const label = useCallback((s: PipelineStepRow) => {
    const iv = interviews.find((i) => i.id === s.interview_id);
    return iv ? `${STEP_LABELS[s.step]} · ${iv.label.replace(/^Interview \d+:\s*/, "")}` : STEP_LABELS[s.step];
  }, [interviews]);

  const runLoop = useCallback(async () => {
    if (loopRef.current) return;
    loopRef.current = true;
    setRunning(true);
    setFatal(null);
    started.current ??= Date.now();
    const poll = setInterval(() => void fetchSteps(), 1500);
    try {
      for (;;) {
        const rows = await fetchSteps();
        const next = rows.find((r) => r.status === "pending" || r.status === "error" || (r.status === "blocked" && interviewReady(r, interviewsRef.current)));
        if (!next) break;
        const res = await api<{ step: PipelineStepRow; complete: boolean }>(`/api/projects/${id}/steps`, { method: "POST", json: { step_key: next.step_key } });
        const after = await fetchSteps();
        if (res.step.status === "error" || res.step.status === "blocked") break;
        if (res.complete || after.every((r) => r.status === "done")) {
          await reload();
          break;
        }
      }
    } catch (e) {
      setFatal((e as Error).message);
    } finally {
      clearInterval(poll);
      loopRef.current = false;
      setRunning(false);
      await fetchSteps();
      await reload();
    }
  }, [fetchSteps, id, reload]);

  // initial load: make sure the plan exists, then run
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    (async () => {
      const rows = await fetchSteps();
      if (cancelled) return;
      if (project.status === "analyzed" || project.status === "decided") return;
      if (!project.locked_at) return;
      if (rows.length === 0) await api(`/api/projects/${id}/analyze`, { method: "POST", json: { mode: "live" } }).catch((e) => setFatal((e as Error).message));
      if (!cancelled) await runLoop();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.status]);

  useEffect(() => {
    if (project?.status === "analyzed" && steps.length && steps.every((s) => s.status === "done") && started.current) {
      const t = setTimeout(() => router.push(`/p/${id}/board`), 900);
      return () => clearTimeout(t);
    }
  }, [project?.status, steps, id, router]);

  if (error) return <PageError message={error} />;
  if (loading || !project) return <Spinner label="Loading" />;
  if (!project.locked_at) {
    return (
      <div>
        <ProjectNav project={project} current="analyze" />
        <Alert tone="info">Analysis has not started. Lock your prediction on the <Link className="font-semibold underline" href={`/p/${id}`}>setup page</Link> first.</Alert>
      </div>
    );
  }

  const done = steps.filter((s) => s.status === "done").length;
  const total = steps.length || 1;
  const failed = steps.find((s) => s.status === "error");
  const blocked = steps.filter((s) => s.status === "blocked");
  const needConfirm = interviews.filter((iv) => iv.needs_confirmation && !iv.speakers_confirmed);
  const complete = project.status === "analyzed" || project.status === "decided";

  async function confirm(iid: string, interviewer: string) {
    await api(`/api/projects/${id}/interviews/${iid}/speakers`, { method: "POST", json: { interviewer } });
    await reload();
    await runLoop();
  }

  return (
    <div>
      <ProjectNav project={project} current="analyze" />

      <Card>
        <CardHeader>
          <CardTitle>{complete ? "Analysis complete" : running ? "Analyzing your interviews…" : failed || blocked.length ? "Analysis paused" : "Ready"}</CardTitle>
          <CardDescription>
            {project.analysis_source === "cached"
              ? "Loaded from the cached demo analysis."
              : "Each step is saved, so if something fails you resume from that step instead of starting over."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-sm font-semibold">
              <span>
                {done} of {total} steps
              </span>
              <span className="font-mono text-ink2" aria-label="elapsed time">{fmtDuration(elapsed)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-paper2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Analysis progress">
              <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          </div>

          {fatal && <Alert tone="error">{fatal}</Alert>}
          {failed && (
            <Alert tone="error" title="A step failed, and nothing is lost">
              <p>{failed.error}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void runLoop()} disabled={running} data-testid="retry">
                  Retry from this step
                </Button>
                {project.is_demo && interviews.length === 6 && (
                  <Button size="sm" variant="outline" onClick={async () => { await api(`/api/projects/${id}/analyze`, { method: "POST", json: { mode: "cached" } }); router.push(`/p/${id}/board`); }}>
                    Use the cached demo analysis instead
                  </Button>
                )}
              </div>
            </Alert>
          )}

          {needConfirm.map((iv) => (
            <SpeakerConfirm key={iv.id} iv={iv} onConfirm={(who) => confirm(iv.id, who)} />
          ))}

          <ol className="divide-y divide-line rounded-lg border border-line" aria-label="Pipeline steps">
            {steps.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-3 py-2.5">
                <StepIcon status={s.status} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-semibold", s.status === "pending" && "text-ink2")}>{label(s)}</p>
                  {(s.note || (s.status === "error" && s.error)) && <p className={cn("text-xs", s.status === "error" ? "text-against" : "text-ink2")}>{s.status === "error" ? s.error : s.note}</p>}
                </div>
                <span className="sr-only">{s.status}</span>
              </li>
            ))}
            {steps.length === 0 && <li className="px-3 py-3 text-sm text-ink2">Preparing…</li>}
          </ol>

          {complete && (
            <Link href={`/p/${id}/board`} className={cn(buttonVariants({ size: "lg" }))} data-testid="to-board">
              Open the evidence board
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function interviewReady(row: PipelineStepRow, interviews: InterviewRow[]) {
  const iv = interviews.find((i) => i.id === row.interview_id);
  return !iv || !iv.needs_confirmation || iv.speakers_confirmed;
}

function StepIcon({ status }: { status: PipelineStepRow["status"] }) {
  if (status === "done") return <Check size={18} className="mt-0.5 text-support" aria-hidden="true" />;
  if (status === "running") return <Loader2 size={18} className="mt-0.5 animate-spin text-signal" aria-hidden="true" />;
  if (status === "error") return <AlertTriangle size={18} className="mt-0.5 text-against" aria-hidden="true" />;
  if (status === "blocked") return <PauseCircle size={18} className="mt-0.5 text-warn" aria-hidden="true" />;
  return <Circle size={18} className="mt-0.5 text-ink2/50" aria-hidden="true" />;
}

function SpeakerConfirm({ iv, onConfirm }: { iv: InterviewRow; onConfirm: (who: string) => Promise<void> }) {
  const [who, setWho] = useState(iv.speakers[0]?.label ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Alert tone="warn" title={`Who is the interviewer in "${iv.label}"?`}>
      <p className="mb-2">We could not tell the speakers apart with confidence. Pick the interviewer (the person asking the questions).</p>
      <fieldset className="space-y-1">
        <legend className="sr-only">Interviewer</legend>
        {iv.speakers.map((s) => (
          <label key={s.label} className="flex min-h-11 items-center gap-2">
            <input type="radio" name={`who-${iv.id}`} checked={who === s.label} onChange={() => setWho(s.label)} />
            <span>
              <b>{s.label}</b> <span className="text-xs text-ink2">({s.turnCount} turns, {Math.round(s.questionRatio * 100)}% contain a question)</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button size="sm" className="mt-2" disabled={busy || !who} onClick={async () => { setBusy(true); await onConfirm(who); setBusy(false); }}>
        Confirm and continue
      </Button>
    </Alert>
  );
}

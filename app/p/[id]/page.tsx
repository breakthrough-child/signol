"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { FileAudio, FileText, Trash2 } from "lucide-react";
import { InterviewAdder } from "@/components/interview-adder";
import { PageError, Spinner } from "@/components/loading";
import { ProjectNav } from "@/components/project-nav";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label, Textarea } from "@/components/ui/form";
import { config } from "@/lib/config";
import { api } from "@/lib/client/api";
import { useProject, useSession } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";

export default function ProjectHub() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const { project, interviews, error, loading, reload } = useProject(id);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [form, setForm] = useState<{ hyp: string; target: string; supporters: number; confidence: number; dirty: boolean } | null>(null);

  if (error) return <PageError message={error} />;
  if (loading || !project) return <Spinner label="Loading project" />;
  const locked = Boolean(project.locked_at);
  const f = form ?? { hyp: project.hypothesis, target: project.target_customer, supporters: project.predicted_supporters, confidence: project.predicted_confidence, dirty: false };
  const setField = (patch: Partial<typeof f>) => setForm({ ...f, ...patch, dirty: true });
  const { hyp, target, supporters, confidence, dirty } = f;
  const tooMany = supporters > interviews.length;
  const canStart = interviews.length > 0 && ack && !tooMany && !dirty;

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      await api(`/api/projects/${id}`, { method: "PATCH", json: { hypothesis: hyp, target_customer: target, predicted_supporters: supporters, predicted_confidence: confidence } });
      await reload();
      setForm(null);
      setMsg({ tone: "ok", text: "Saved." });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function start(mode: "live" | "cached") {
    setBusy(mode);
    setMsg(null);
    try {
      await api(`/api/projects/${id}/analyze`, { method: "POST", json: { mode } });
      router.push(mode === "cached" ? `/p/${id}/board` : `/p/${id}/analyze`);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
      setBusy(null);
    }
  }

  async function remove(iid: string) {
    setBusy(`rm-${iid}`);
    try {
      await api(`/api/projects/${id}/interviews/${iid}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const next = project.status === "decided" ? "outputs" : project.status === "analyzed" ? "board" : "analyze";

  return (
    <div>
      <ProjectNav project={project} current="setup" />

      {project.is_demo && !locked && (
        <Alert tone="signal" className="mb-5" title="This is the demo project">
          Six sample interviews with Lagos restaurant owners are loaded, and a hypothesis and prediction are pre-filled. Go through Checkpoint 1 below, then run the analysis live or use the cached analysis.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <p className="text-xs font-bold uppercase tracking-wider text-signal">Checkpoint 1 · pre-commit</p>
            <CardTitle>Hypothesis and prediction</CardTitle>
            <CardDescription>{locked ? "Locked since analysis started, so the evidence cannot change what you said you believed." : "Editable until you start the analysis. Then it locks."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="hyp">Hypothesis</Label>
              <Textarea id="hyp" value={hyp} disabled={locked} onChange={(e) => setField({ hyp: e.target.value })} rows={3} />
            </div>
            <div>
              <Label htmlFor="tc">Target customer</Label>
              <Input id="tc" value={target} disabled={locked} onChange={(e) => setField({ target: e.target.value })} />
            </div>
            <div className="grid grid-cols-[auto_1fr] items-end gap-4">
              <div>
                <Label htmlFor="sup">Predicted supporters</Label>
                <Input id="sup" type="number" min={0} max={15} className="w-24" value={supporters} disabled={locked} onChange={(e) => setField({ supporters: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div>
                <Label htmlFor="conf">
                  Confidence <span className="font-mono text-signal">{confidence}%</span>
                </Label>
                <input id="conf" type="range" min={0} max={100} step={5} value={confidence} disabled={locked} onChange={(e) => setField({ confidence: Number(e.target.value) })} className="w-full" />
              </div>
            </div>
            {tooMany && !locked && <Alert tone="warn">You predicted {supporters} supporters but have {interviews.length} interview{interviews.length === 1 ? "" : "s"}. Lower the prediction or add interviews.</Alert>}
            {!locked && dirty && (
              <Button variant="outline" onClick={save} disabled={busy === "save"}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </Button>
            )}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Interviews <span className="font-sans text-sm font-semibold text-ink2">({interviews.length}/{config.limits.maxInterviews})</span>
            </CardTitle>
            <CardDescription>Add 1 to {config.limits.maxInterviews} interviews: pasted transcripts, notes (.txt, .md, .docx) or audio (.mp3, .m4a, .wav).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {interviews.length === 0 && <p className="text-sm text-ink2">No interviews yet.</p>}
            <ul className="space-y-2">
              {interviews.map((iv) => (
                <li key={iv.id} className="flex items-center gap-3 rounded-lg border border-line bg-paper2/50 px-3 py-2">
                  {iv.source_type === "audio" ? <FileAudio size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{iv.label}</p>
                    <p className="text-xs text-ink2">
                      {iv.source_type === "audio" ? "Audio, transcribed at analysis" : `${iv.word_count.toLocaleString()} words`}
                      {iv.original_filename ? ` · ${iv.original_filename}` : ""}
                    </p>
                  </div>
                  {locked ? (
                    <Link className="text-xs font-semibold text-signal underline" href={`/p/${id}/t/${iv.id}`}>
                      Transcript
                    </Link>
                  ) : (
                    <Button variant="ghost" size="sm" aria-label={`Remove ${iv.label}`} disabled={busy === `rm-${iv.id}`} onClick={() => remove(iv.id)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!locked && session.userId && <InterviewAdder projectId={id} userId={session.userId} count={interviews.length} onAdded={reload} />}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardContent className="pt-5">
          {locked ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="support">Analysis {project.status === "analyzing" ? "in progress" : "started"}</Badge>
              <Link href={`/p/${id}/${next}`} className={cn(buttonVariants({ size: "lg" }))} data-testid="continue">
                Continue
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ack-lock" />
                <span>
                  <b>I understand my hypothesis and prediction lock when analysis starts.</b> I will not be able to edit them after seeing the evidence.
                </span>
              </label>
              {dirty && <Hint>Save your changes first.</Hint>}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" disabled={!canStart || busy !== null} onClick={() => start("live")} data-testid="start-analysis">
                  {busy === "live" ? "Locking…" : "Lock prediction and start analysis"}
                </Button>
                {project.is_demo && (
                  <Button size="lg" variant="outline" disabled={!canStart || busy !== null} onClick={() => start("cached")} data-testid="use-cached">
                    {busy === "cached" ? "Loading…" : "Lock and use cached analysis"}
                  </Button>
                )}
              </div>
              {project.is_demo && <Hint>The cached analysis is a pre-computed result for these exact demo interviews, shown instantly in case the free AI tier is busy. It is clearly labelled as cached. Its quotes are still verified against the transcripts by code.</Hint>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

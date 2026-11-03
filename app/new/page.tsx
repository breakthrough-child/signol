"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label, Textarea } from "@/components/ui/form";
import { api } from "@/lib/client/api";
import { ensureSession } from "@/lib/supabase/browser";

export default function NewProject() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [target, setTarget] = useState("");
  const [supporters, setSupporters] = useState(3);
  const [confidence, setConfidence] = useState(60);
  const [benchmark, setBenchmark] = useState(false);
  const [manualMinutes, setManualMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const mins = benchmark && manualMinutes ? Number(manualMinutes) : null;
      const p = await api<{ id: string }>("/api/projects", {
        method: "POST",
        json: {
          name: name || hypothesis.slice(0, 60),
          hypothesis,
          target_customer: target,
          predicted_supporters: supporters,
          predicted_confidence: confidence,
          benchmark_manual_minutes: mins && Number.isFinite(mins) ? Math.round(mins) : null,
        },
      });
      router.push(`/p/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm font-semibold text-signal">Checkpoint 1 of 2</p>
      <h1 className="font-display text-3xl font-semibold">Pre-commit before you see any analysis</h1>
      <p className="mt-2 text-ink2">
        Write down what you believe and how confident you are <em>now</em>. When you start the analysis, this locks. Pre-committing stops you from rationalizing the evidence afterwards, and it lets signol show you how well calibrated you were.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Your hypothesis</CardTitle>
            <CardDescription>One falsifiable sentence: who will do what, and why they would pay.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="hypothesis">Hypothesis</Label>
              <Textarea
                id="hypothesis"
                required
                minLength={5}
                maxLength={1000}
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                placeholder="Small restaurant owners in Lagos will pay monthly for automated inventory tracking"
                aria-describedby="h-hint"
              />
              <Hint id="h-hint">Good: &ldquo;Freelance designers in Paris will pay €15/month to automate invoicing.&rdquo; Weak: &ldquo;People need better invoicing.&rdquo;</Hint>
            </div>
            <div>
              <Label htmlFor="target">Target customer</Label>
              <Input id="target" required minLength={2} maxLength={500} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Owners of small restaurants with 5 to 15 staff" />
            </div>
            <div>
              <Label htmlFor="name">Project name (optional)</Label>
              <Input id="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lagos restaurants" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your prediction</CardTitle>
            <CardDescription>Guess first. The evidence will be compared with this after you decide.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label htmlFor="supporters">How many of your interviewees will support the hypothesis?</Label>
              <Input id="supporters" type="number" min={0} max={15} required value={supporters} onChange={(e) => setSupporters(Math.max(0, Math.min(15, Number(e.target.value) || 0)))} className="max-w-28" />
              <Hint>&ldquo;Support&rdquo; will mean strong evidence in their words, such as real past behavior or a specific pain, not a polite yes.</Hint>
            </div>
            <div>
              <Label htmlFor="confidence">
                How confident are you? <span className="font-mono text-signal">{confidence}%</span>
              </Label>
              <input id="confidence" type="range" min={0} max={100} step={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="w-full" aria-valuetext={`${confidence} percent`} />
              <div className="flex justify-between text-xs text-ink2">
                <span>0% (a coin flip or worse)</span>
                <span>100% (certain)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={benchmark} onChange={(e) => setBenchmark(e.target.checked)} />
              <span>
                <b>Benchmark mode (optional).</b> I also synthesised these interviews by hand, or know how long it usually takes me. signol will store that next to the time it took with signol.
              </span>
            </label>
            {benchmark && (
              <div className="mt-3 max-w-xs">
                <Label htmlFor="mins">Minutes it takes (or took) me manually</Label>
                <Input id="mins" type="number" min={1} max={6000} value={manualMinutes} onChange={(e) => setManualMinutes(e.target.value)} placeholder="e.g. 420" />
              </div>
            )}
          </CardContent>
        </Card>

        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Creating…" : "Save and add interviews"}
        </Button>
      </form>
    </div>
  );
}

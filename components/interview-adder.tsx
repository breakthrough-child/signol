"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Hint, Input, Label, Textarea } from "@/components/ui/form";
import { config } from "@/lib/config";
import { api } from "@/lib/client/api";
import { ACCEPTED_FILES, labelFromFilename, safeFilename, sourceTypeFromFilename } from "@/lib/files";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function InterviewAdder({ projectId, userId, count, onAdded }: { projectId: string; userId: string; count: number; onAdded: () => void | Promise<void> }) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = count >= config.limits.maxInterviews;

  async function addPaste(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/interviews`, { method: "POST", json: { source_type: "paste", label: label || `Interview ${count + 1}`, text } });
      setLabel("");
      setText("");
      await onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        if (count + added >= config.limits.maxInterviews) throw new Error(`A project can have at most ${config.limits.maxInterviews} interviews.`);
        const kind = sourceTypeFromFilename(file.name);
        if (!kind) throw new Error(`"${file.name}" is not supported. Use .mp3, .m4a, .wav, .txt, .md or .docx.`);
        if (file.size > config.limits.maxFileMb * 1024 * 1024) throw new Error(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. Files can be at most ${config.limits.maxFileMb} MB.`);
        setProgress(`Uploading ${file.name}…`);
        const path = `${userId}/${projectId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
        const up = await sb.storage.from("interviews").upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (up.error) throw new Error(`Upload failed for "${file.name}": ${up.error.message}`);
        setProgress(kind === "audio" ? `Saved ${file.name} (it is transcribed when analysis starts)` : `Reading ${file.name}…`);
        await api(`/api/projects/${projectId}/interviews`, { method: "POST", json: { source_type: kind, label: label && files.length === 1 ? label : labelFromFilename(file.name), storage_path: path, filename: file.name } });
        added++;
      }
      setLabel("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await onAdded();
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (full) return <Alert tone="info">This project has the maximum of {config.limits.maxInterviews} interviews.</Alert>;

  return (
    <div className="rounded-xl border border-dashed border-line bg-paper2/60 p-4">
      <div role="tablist" aria-label="How to add an interview" className="mb-3 inline-flex rounded-lg border border-line bg-card p-1">
        {(["paste", "file"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`min-h-9 rounded-md px-3 text-sm font-semibold ${mode === m ? "bg-ink text-paper" : "text-ink2 hover:bg-paper2"}`}
            type="button"
          >
            {m === "paste" ? "Paste transcript or notes" : "Upload file or audio"}
          </button>
        ))}
      </div>
      <div className="mb-3">
        <Label htmlFor="iv-label">Label</Label>
        <Input id="iv-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`Interview ${count + 1}: Bola, restaurant owner`} maxLength={160} />
        <Hint>Put the interviewee&apos;s first name after a colon (like above). signol uses it to tell interviewer and interviewee apart.</Hint>
      </div>
      {mode === "paste" ? (
        <form onSubmit={addPaste}>
          <Label htmlFor="iv-text">Transcript or notes</Label>
          <Textarea id="iv-text" required rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Interviewer: How do you track stock today?\nBola: We write it in a notebook every night…"} />
          <Hint>Speaker-labelled transcripts work best (&ldquo;Name: …&rdquo;). Rough notes are fine too.</Hint>
          <Button type="submit" className="mt-3" disabled={busy || text.trim().length < 20}>
            {busy ? "Adding…" : "Add interview"}
          </Button>
        </form>
      ) : (
        <div>
          <Label htmlFor="iv-file">Files (.txt, .md, .docx, .mp3, .m4a, .wav; up to {config.limits.maxFileMb} MB each)</Label>
          <input ref={fileRef} id="iv-file" type="file" multiple accept={ACCEPTED_FILES} disabled={busy} onChange={(e) => void addFiles(e.target.files)} className="block w-full min-h-11 rounded-lg border border-line bg-card p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper" />
          <Hint>Files are stored privately and only you can read them. Audio is transcribed with Whisper.</Hint>
          {progress && <p className="mt-2 text-sm text-ink2" role="status">{progress}</p>}
        </div>
      )}
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </div>
  );
}

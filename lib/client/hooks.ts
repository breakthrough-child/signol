"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewRow, ProjectRow } from "@/lib/db-types";
import { ensureSession, supabaseBrowser } from "@/lib/supabase/browser";

/** Makes sure the visitor has an (anonymous) session before any data is loaded. */
export function useSession() {
  const [state, setState] = useState<{ ready: boolean; error: string | null; userId: string | null }>({ ready: false, error: null, userId: null });
  useEffect(() => {
    let alive = true;
    ensureSession()
      .then((userId) => alive && setState({ ready: true, error: null, userId }))
      .catch((e: Error) => alive && setState({ ready: false, error: e.message, userId: null }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export function useProject(id: string) {
  const session = useSession();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const sb = supabaseBrowser();
    const [p, iv] = await Promise.all([
      sb.from("projects").select("*").eq("id", id).maybeSingle(),
      sb.from("interviews").select("*").eq("project_id", id).order("position", { ascending: true }),
    ]);
    if (!alive.current) return;
    if (p.error) setError(p.error.message);
    else if (!p.data) setError("We could not find this project. It may belong to another browser session, or it was deleted.");
    else {
      setProject(p.data as ProjectRow);
      setError(null);
    }
    setInterviews((iv.data ?? []) as InterviewRow[]);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    alive.current = true;
    if (!session.ready) return;
    const t = setTimeout(() => void reload(), 0);
    return () => {
      alive.current = false;
      clearTimeout(t);
    };
  }, [session.ready, reload]);

  return { project, interviews, error: error ?? session.error, loading: loading && !session.error, reload, setProject };
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "n/a";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

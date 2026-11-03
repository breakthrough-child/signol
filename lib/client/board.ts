"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeadingQuestionRow, StatementRow, SynthesisRow } from "@/lib/db-types";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useProject } from "./hooks";

export function useBoard(id: string) {
  const base = useProject(id);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [leading, setLeading] = useState<LeadingQuestionRow[]>([]);
  const [synthesis, setSynthesis] = useState<SynthesisRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  const status = base.project?.status;
  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [st, lq, sy] = await Promise.all([
      sb.from("statements").select("*").eq("project_id", id).order("turn_idx", { ascending: true }),
      sb.from("leading_questions").select("*").eq("project_id", id).order("turn_idx", { ascending: true }),
      sb.from("syntheses").select("*").eq("project_id", id).maybeSingle(),
    ]);
    if (st.error || lq.error || sy.error) {
      setBoardError((st.error ?? lq.error ?? sy.error)!.message);
      return;
    }
    setStatements((st.data ?? []) as StatementRow[]);
    setLeading((lq.data ?? []) as LeadingQuestionRow[]);
    setSynthesis(sy.data as SynthesisRow | null);
    setLoaded(true);
  }, [id]);

  const needsData = status === "analyzed" || status === "decided";
  useEffect(() => {
    if (!base.project || !needsData) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [base.project, needsData, load]);
  const ready = Boolean(base.project) && (needsData ? loaded : true);

  return { ...base, statements, leading, synthesis, ready, boardError, reloadBoard: load };
}

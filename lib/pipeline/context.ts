import type { SupabaseClient } from "@supabase/supabase-js";
import { getLlm } from "@/lib/llm";
import type { LlmClient } from "@/lib/llm/client";
import type { LlmEvent, LlmLog } from "@/lib/llm/types";
import type { ProjectRow } from "@/lib/db-types";
import { HttpError } from "@/lib/supabase/server";

export interface PipelineCtx {
  supabase: SupabaseClient;
  userId: string;
  project: ProjectRow;
  /** LLM client wired to run_logs + live step notes. */
  llmFor(stepKey: string): LlmClient;
  log(entry: Omit<LlmLog, "ok"> & { ok?: boolean }): Promise<void>;
}

export async function loadProject(supabase: SupabaseClient, projectId: string): Promise<ProjectRow> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Project not found.", "not_found");
  return data as ProjectRow;
}

export async function makeCtx(supabase: SupabaseClient, userId: string, projectId: string): Promise<PipelineCtx> {
  const project = await loadProject(supabase, projectId);
  const log: PipelineCtx["log"] = async (l) => {
    await supabase.from("run_logs").insert({
      project_id: projectId,
      step: l.step,
      provider: l.provider,
      model: l.model,
      tokens_in: l.tokensIn,
      tokens_out: l.tokensOut,
      latency_ms: l.latencyMs,
      ok: l.ok ?? true,
      error: l.error ?? null,
    });
  };
  return {
    supabase,
    userId,
    project,
    log,
    llmFor(stepKey: string) {
      const setNote = async (note: string) => {
        await supabase.from("pipeline_steps").update({ note, updated_at: new Date().toISOString() }).eq("project_id", projectId).eq("step_key", stepKey);
      };
      return getLlm({
        onLog: (l: LlmLog) => log(l),
        onEvent: async (e: LlmEvent) => {
          if (e.type === "retry") await setNote(`Rate limited by ${e.provider}; retrying in ${Math.ceil(e.inMs / 1000)}s…`);
          else if (e.type === "fallback") await setNote(e.to ? `${e.from} unavailable; switching to fallback provider (${e.to})…` : `${e.from} unavailable.`);
          else if (e.type === "reask") await setNote(`${e.provider} returned invalid JSON; asking once more…`);
        },
      });
    },
  };
}

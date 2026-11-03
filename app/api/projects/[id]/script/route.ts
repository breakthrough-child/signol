import { fail, handle, ok, type IdCtx } from "@/lib/api";
import type { ScriptDoc, SynthesisRow } from "@/lib/db-types";
import { makeCtx } from "@/lib/pipeline/context";
import { buildScript } from "@/lib/pipeline/script";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Next-interview script: leading questions rewritten + 3-5 new past-behavior questions. Cached once generated. */
export const POST = handle(async (_req: Request, routeCtx: IdCtx) => {
  const { id } = await routeCtx.params;
  const { supabase, user } = await requireUser();
  const ctx = await makeCtx(supabase, user.id, id);
  const sy = await supabase.from("syntheses").select("*").eq("project_id", id).maybeSingle();
  const synthesis = sy.data as SynthesisRow | null;
  if (!synthesis || (ctx.project.status !== "analyzed" && ctx.project.status !== "decided")) return fail(409, "Finish the analysis first.", "not_ready");
  if (synthesis.script) return ok({ script: synthesis.script as ScriptDoc });
  const script = await buildScript(ctx, synthesis);
  const { error } = await supabase.from("syntheses").update({ script }).eq("project_id", id);
  if (error) return fail(400, error.message);
  return ok({ script });
});

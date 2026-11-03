import { fail, handle, ok, type IdIidCtx } from "@/lib/api";
import { loadProject } from "@/lib/pipeline/context";
import { requireUser } from "@/lib/supabase/server";

export const DELETE = handle(async (_req: Request, ctx: IdIidCtx) => {
  const { id, iid } = await ctx.params;
  const { supabase } = await requireUser();
  const project = await loadProject(supabase, id);
  if (project.locked_at) return fail(409, "Analysis has started, so interviews can no longer be removed.", "locked");
  const iv = await supabase.from("interviews").select("storage_path").eq("id", iid).eq("project_id", id).maybeSingle();
  const path = (iv.data as { storage_path: string | null } | null)?.storage_path;
  if (path) await supabase.storage.from("interviews").remove([path]);
  const { error } = await supabase.from("interviews").delete().eq("id", iid).eq("project_id", id);
  if (error) return fail(400, error.message);
  return ok({ deleted: true });
});

import { fail, handle, ok, type IdCtx } from "@/lib/api";
import { loadProject } from "@/lib/pipeline/context";
import { requireUser } from "@/lib/supabase/server";
import { projectInput } from "../route";

/** Edit the hypothesis/prediction. Allowed only until analysis starts (also enforced by a DB trigger). */
export const PATCH = handle(async (req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const project = await loadProject(supabase, id);
  const body = await req.json().catch(() => null);
  if (body && "benchmark_manual_minutes" in body && Object.keys(body).length === 1) {
    const v = body.benchmark_manual_minutes;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 6000)) return fail(400, "Enter the minutes as a whole number between 1 and 6000.");
    const { data, error } = await supabase.from("projects").update({ benchmark_manual_minutes: v }).eq("id", id).select().single();
    if (error) return fail(400, error.message);
    return ok(data);
  }
  if (project.locked_at) return fail(409, "The hypothesis and prediction are locked because analysis has started.", "locked");
  const parsed = projectInput.partial().safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid");
  const { data, error } = await supabase.from("projects").update(parsed.data).eq("id", id).select().single();
  if (error) return fail(400, error.message);
  return ok(data);
});

/** Delete the project and everything attached to it, including stored files. */
export const DELETE = handle(async (_req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { supabase, user } = await requireUser();
  await loadProject(supabase, id);
  const files = await supabase.from("interviews").select("storage_path").eq("project_id", id);
  const paths = ((files.data ?? []) as { storage_path: string | null }[]).map((f) => f.storage_path).filter(Boolean) as string[];
  if (paths.length) await supabase.storage.from("interviews").remove(paths);
  const { error } = await supabase.from("projects").delete().eq("id", id).eq("owner_id", user.id);
  if (error) return fail(400, error.message);
  return ok({ deleted: true });
});

import crypto from "node:crypto";
import { fail, handle, ok, type IdCtx } from "@/lib/api";
import { requireUser } from "@/lib/supabase/server";

/** Create (or return) the unguessable read-only link for the decision log. */
export const POST = handle(async (_req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const d = await supabase.from("decisions").select("id,share_token").eq("project_id", id).maybeSingle();
  const row = d.data as { id: string; share_token: string | null } | null;
  if (!row) return fail(409, "Record a decision before sharing the log.", "no_decision");
  if (row.share_token) return ok({ path: `/s/${row.share_token}` });
  const token = crypto.randomBytes(24).toString("base64url");
  const { error } = await supabase.from("decisions").update({ share_token: token }).eq("id", row.id);
  if (error) return fail(400, error.message);
  return ok({ path: `/s/${token}` });
});

export const DELETE = handle(async (_req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const { error } = await supabase.from("decisions").update({ share_token: null }).eq("project_id", id);
  if (error) return fail(400, error.message);
  return ok({ revoked: true });
});

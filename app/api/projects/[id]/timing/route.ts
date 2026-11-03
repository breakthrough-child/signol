import { z } from "zod";
import { fail, handle, ok, type IdCtx } from "@/lib/api";
import { requireUser } from "@/lib/supabase/server";

const input = z.object({ seconds: z.number().min(0).max(6 * 3600) });

/** Time spent on the evidence board (analysis and decision times are logged server-side). */
export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { supabase } = await requireUser();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Bad request");
  const { error } = await supabase.from("timing_events").insert({ project_id: id, event: "board_viewed", meta: { seconds: Math.round(parsed.data.seconds) } });
  if (error) return fail(400, error.message);
  return ok({ ok: true });
});

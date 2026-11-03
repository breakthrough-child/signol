import { z } from "zod";
import { fail, handle, ok, type IdIidCtx } from "@/lib/api";
import { loadProject } from "@/lib/pipeline/context";
import { requireUser } from "@/lib/supabase/server";

const input = z.object({ interviewer: z.string().min(1).max(60) });

/** The lightweight "who is the interviewer?" confirmation step. */
export const POST = handle(async (req: Request, ctx: IdIidCtx) => {
  const { id, iid } = await ctx.params;
  const { supabase } = await requireUser();
  await loadProject(supabase, id);
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Pick which speaker is the interviewer.");
  const iv = await supabase.from("interviews").select("id,speakers").eq("id", iid).eq("project_id", id).maybeSingle();
  if (!iv.data) return fail(404, "Interview not found.");
  const labels = ((iv.data as { speakers: { label: string }[] }).speakers ?? []).map((s) => s.label);
  if (!labels.includes(parsed.data.interviewer)) return fail(400, "That speaker is not in this transcript.");

  const speakers = (iv.data as { speakers: Record<string, unknown>[] }).speakers.map((s) => ({ ...s, role: s.label === parsed.data.interviewer ? "interviewer" : "interviewee" }));
  const turns = await supabase.from("turns").select("id,speaker").eq("interview_id", iid);
  const toInterviewer = ((turns.data ?? []) as { id: string; speaker: string }[]).filter((t) => t.speaker === parsed.data.interviewer).map((t) => t.id);
  const toInterviewee = ((turns.data ?? []) as { id: string; speaker: string }[]).filter((t) => t.speaker !== parsed.data.interviewer).map((t) => t.id);
  if (toInterviewer.length) await supabase.from("turns").update({ role: "interviewer" }).in("id", toInterviewer);
  if (toInterviewee.length) await supabase.from("turns").update({ role: "interviewee" }).in("id", toInterviewee);
  const { error } = await supabase.from("interviews").update({ speakers, speakers_confirmed: true }).eq("id", iid);
  if (error) return fail(400, error.message);
  return ok({ confirmed: true });
});

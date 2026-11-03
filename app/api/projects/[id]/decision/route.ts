import { z } from "zod";
import { fail, handle, ok, type IdCtx } from "@/lib/api";
import { checkFriction } from "@/lib/decision";
import { makeCtx } from "@/lib/pipeline/context";
import { buildDecisionLog, loadBoardData } from "@/lib/pipeline/log";
import { requireUser } from "@/lib/supabase/server";

const input = z.object({
  choice: z.enum(["validated", "invalidated", "need_more_evidence"]),
  responses: z.array(z.object({ statement_id: z.string().uuid(), response: z.string().max(2000) })).max(12).default([]),
});

/** Checkpoint 2. The friction rules are enforced here, not just in the UI. */
export const POST = handle(async (req: Request, routeCtx: IdCtx) => {
  const { id } = await routeCtx.params;
  const { supabase, user } = await requireUser();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Choose Validated, Invalidated or Need more evidence.");
  const ctx = await makeCtx(supabase, user.id, id);
  if (ctx.project.status === "decided") return fail(409, "A decision has already been recorded for this project.", "decided");
  if (ctx.project.status !== "analyzed") return fail(409, "The analysis has to finish before you can decide.", "not_ready");

  const data = await loadBoardData(ctx);
  const friction = checkFriction(
    parsed.data.choice,
    data.synthesis.top_for.map((p) => p.statement_id),
    data.synthesis.top_against.map((p) => p.statement_id),
    parsed.data.responses,
  );
  if (!friction.ok) return fail(422, friction.message ?? "Respond to the evidence first.", "friction");

  const decidedAt = new Date().toISOString();
  const required = new Set(friction.required);
  const responses = parsed.data.responses.filter((r) => required.has(r.statement_id) || data.synthesis.top_for.concat(data.synthesis.top_against).some((p) => p.statement_id === r.statement_id));
  const { log, calibration } = buildDecisionLog(data, parsed.data.choice, responses, decidedAt);
  const stored = responses.map((r) => ({
    statement_id: r.statement_id,
    side: data.synthesis.top_for.some((p) => p.statement_id === r.statement_id) ? "for" : "against",
    response: r.response.trim(),
  }));
  const ins = await supabase.from("decisions").insert({ project_id: id, choice: parsed.data.choice, responses: stored, calibration, log, decided_at: decidedAt }).select().single();
  if (ins.error) return fail(400, ins.error.message);
  await supabase.from("projects").update({ status: "decided" }).eq("id", id);
  await supabase.from("timing_events").insert({ project_id: id, event: "decision_made", meta: { choice: parsed.data.choice } });
  return ok(ins.data, 201);
});

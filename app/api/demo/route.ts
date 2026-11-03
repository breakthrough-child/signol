import { fail, handle, ok } from "@/lib/api";
import { demoSeed } from "@/lib/demo";
import { wordCount } from "@/lib/utils";
import { requireUser } from "@/lib/supabase/server";

/**
 * "Try the demo": creates a fresh sample project for the (anonymous) visitor.
 * Hypothesis and prediction are pre-filled but NOT locked, so the visitor still goes through Checkpoint 1.
 */
export const POST = handle(async () => {
  const { supabase } = await requireUser();
  const p = await supabase
    .from("projects")
    .insert({ ...demoSeed.project, is_demo: true, status: "draft" })
    .select()
    .single();
  if (p.error) return fail(400, p.error.message);
  const rows = demoSeed.interviews.map((iv, i) => ({
    project_id: p.data.id,
    position: i + 1,
    label: iv.label,
    source_type: "paste",
    raw_text: iv.text,
    word_count: wordCount(iv.text),
  }));
  const r = await supabase.from("interviews").insert(rows).select("id");
  if (r.error) return fail(400, r.error.message);
  return ok({ id: p.data.id }, 201);
});

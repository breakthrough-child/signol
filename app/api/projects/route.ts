import { z } from "zod";
import { fail, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/supabase/server";

export const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  hypothesis: z.string().trim().min(5).max(1000),
  target_customer: z.string().trim().min(2).max(500),
  predicted_supporters: z.number().int().min(0).max(15),
  predicted_confidence: z.number().int().min(0).max(100),
  benchmark_manual_minutes: z.number().int().min(1).max(6000).nullable().optional(),
});

export const POST = handle(async (req: Request) => {
  const { supabase } = await requireUser();
  const parsed = projectInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid");
  const { data, error } = await supabase.from("projects").insert({ ...parsed.data, status: "draft" }).select().single();
  if (error) return fail(400, error.message);
  return ok(data, 201);
});

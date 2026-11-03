import { fail, handle, type IdCtx } from "@/lib/api";
import { decisionLogToMarkdown, type DecisionLog } from "@/lib/decision";
import type { ScriptDoc } from "@/lib/db-types";
import { decisionLogToPdf, scriptToMarkdown, scriptToPdf } from "@/lib/export/pdf";
import { loadProject } from "@/lib/pipeline/context";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 30;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";

/** GET ?doc=log|script&format=md|pdf */
export const GET = handle(async (req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const doc = url.searchParams.get("doc") === "script" ? "script" : "log";
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "md";
  const { supabase } = await requireUser();
  const project = await loadProject(supabase, id);

  let body: string | Buffer;
  if (doc === "log") {
    const d = await supabase.from("decisions").select("log").eq("project_id", id).maybeSingle();
    const log = (d.data as { log: DecisionLog } | null)?.log;
    if (!log) return fail(409, "Record a decision first; the decision log is created at Checkpoint 2.", "no_decision");
    body = format === "pdf" ? await decisionLogToPdf(log) : decisionLogToMarkdown(log);
  } else {
    const s = await supabase.from("syntheses").select("script").eq("project_id", id).maybeSingle();
    const script = (s.data as { script: ScriptDoc | null } | null)?.script;
    if (!script) return fail(409, "Generate the next interview script first.", "no_script");
    body = format === "pdf" ? await scriptToPdf(project.name, project.hypothesis, script) : scriptToMarkdown(project.name, project.hypothesis, script);
  }
  const filename = `signol-${doc === "log" ? "decision-log" : "next-interview-script"}-${slug(project.name)}.${format}`;
  return new Response(body as BodyInit, {
    headers: {
      "content-type": format === "pdf" ? "application/pdf" : "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});

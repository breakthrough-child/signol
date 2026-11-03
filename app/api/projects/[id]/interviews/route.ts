import { z } from "zod";
import { config } from "@/lib/config";
import { extractText, sourceTypeFromFilename, validateText } from "@/lib/ingest";
import { fail, handle, ok, type IdCtx } from "@/lib/api";
import { loadProject } from "@/lib/pipeline/context";
import { HttpError, requireUser } from "@/lib/supabase/server";
import { wordCount } from "@/lib/utils";

const input = z.discriminatedUnion("source_type", [
  z.object({ source_type: z.literal("paste"), label: z.string().trim().min(1).max(160), text: z.string() }),
  z.object({ source_type: z.enum(["text_file", "docx", "audio"]), label: z.string().trim().min(1).max(160), storage_path: z.string().min(3), filename: z.string().min(1).max(200) }),
]);

export const POST = handle(async (req: Request, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { supabase, user } = await requireUser();
  const project = await loadProject(supabase, id);
  if (project.locked_at) return fail(409, "Analysis has started, so interviews can no longer be added. Create a new project to add more.", "locked");
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Give the interview a label and some content.", "invalid");

  const existing = await supabase.from("interviews").select("position").eq("project_id", id).order("position", { ascending: false });
  const rows = (existing.data ?? []) as { position: number }[];
  if (rows.length >= config.limits.maxInterviews) return fail(400, `A project can have at most ${config.limits.maxInterviews} interviews.`, "too_many");
  const position = rows.length ? rows[0].position + 1 : 1;

  let row: Record<string, unknown>;
  const d = parsed.data;
  if (d.source_type === "paste") {
    const text = validateText(d.text);
    row = { label: d.label, source_type: "paste", raw_text: text, word_count: wordCount(text) };
  } else {
    if (!d.storage_path.startsWith(`${user.id}/${id}/`)) throw new HttpError(400, "Invalid file location.");
    const kind = sourceTypeFromFilename(d.filename);
    if (!kind || kind !== d.source_type) return fail(400, "Unsupported file type. Use .mp3, .m4a, .wav, .txt, .md or .docx.", "bad_type");
    if (d.source_type === "audio") {
      row = { label: d.label, source_type: "audio", storage_path: d.storage_path, original_filename: d.filename };
    } else {
      const dl = await supabase.storage.from("interviews").download(d.storage_path);
      if (dl.error || !dl.data) return fail(400, "The uploaded file could not be read. Please try again.", "upload_missing");
      const text = await extractText(d.source_type, dl.data);
      row = { label: d.label, source_type: d.source_type, storage_path: d.storage_path, original_filename: d.filename, raw_text: text, word_count: wordCount(text) };
    }
  }
  const { data, error } = await supabase.from("interviews").insert({ ...row, project_id: id, position }).select().single();
  if (error) return fail(400, error.message);
  return ok(data, 201);
});

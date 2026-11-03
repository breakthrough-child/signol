import mammoth from "mammoth";
import { config } from "@/lib/config";
import { HttpError } from "@/lib/supabase/server";

import { sourceTypeFromFilename, type SourceType } from "@/lib/files";

export { sourceTypeFromFilename };
export type { SourceType };

export function validateText(text: string): string {
  const t = text.replace(/\u0000/g, "").trim();
  if (t.length < 20) throw new HttpError(400, "That text is too short to be an interview. Paste the full transcript or notes.", "too_short");
  if (t.length > config.limits.maxTextChars) {
    throw new HttpError(400, `That text is over the ${config.limits.maxTextChars.toLocaleString()} character limit (about ${Math.round(config.limits.maxTextChars / 6)} words). Split it into two interviews.`, "too_long");
  }
  return t;
}

export async function extractText(type: SourceType, data: Blob): Promise<string> {
  if (data.size > config.limits.maxFileMb * 1024 * 1024) throw new HttpError(400, `Files can be at most ${config.limits.maxFileMb} MB.`, "too_big");
  if (type === "docx") {
    const buf = Buffer.from(await data.arrayBuffer());
    try {
      const r = await mammoth.extractRawText({ buffer: buf });
      return validateText(r.value);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "Could not read that .docx file. Try saving it again or paste the text.", "bad_docx");
    }
  }
  return validateText(await data.text());
}

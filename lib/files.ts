/** File-type helpers shared by browser and server (no server-only imports here). */
export type SourceType = "paste" | "text_file" | "docx" | "audio";

const AUDIO_EXT = /\.(mp3|m4a|wav)$/i;
const TEXT_EXT = /\.(txt|md|markdown)$/i;
const DOCX_EXT = /\.docx$/i;

export function sourceTypeFromFilename(name: string): SourceType | null {
  if (AUDIO_EXT.test(name)) return "audio";
  if (DOCX_EXT.test(name)) return "docx";
  if (TEXT_EXT.test(name)) return "text_file";
  return null;
}

export const ACCEPTED_FILES = ".mp3,.m4a,.wav,.txt,.md,.docx";

export function labelFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "Interview";
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
}

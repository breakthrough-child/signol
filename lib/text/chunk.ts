import type { Turn } from "@/lib/types";
import { wordCount } from "@/lib/utils";

export interface Chunk {
  index: number;
  turns: Turn[];
  words: number;
}

/**
 * Group turns into "exchanges" (a run of interviewer turns followed by the
 * interviewee's answer) and pack exchanges into chunks of ~maxWords, so a
 * question is never separated from its answer. A single oversized exchange
 * becomes its own chunk (never split mid-turn).
 */
export function chunkTurns(turns: Turn[], maxWords: number): Chunk[] {
  const exchanges: Turn[][] = [];
  let cur: Turn[] = [];
  let sawAnswer = false;
  for (const t of turns) {
    if (t.role === "interviewer" && sawAnswer) {
      exchanges.push(cur);
      cur = [];
      sawAnswer = false;
    }
    cur.push(t);
    if (t.role === "interviewee") sawAnswer = true;
  }
  if (cur.length) exchanges.push(cur);

  const chunks: Chunk[] = [];
  let acc: Turn[] = [];
  let words = 0;
  for (const ex of exchanges) {
    const w = ex.reduce((n, t) => n + wordCount(t.text), 0);
    if (acc.length && words + w > maxWords) {
      chunks.push({ index: chunks.length, turns: acc, words });
      acc = [];
      words = 0;
    }
    acc.push(...ex);
    words += w;
  }
  if (acc.length) chunks.push({ index: chunks.length, turns: acc, words });
  return chunks;
}

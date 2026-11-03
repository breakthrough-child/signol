import type { Role, Turn } from "@/lib/types";
import { findQuote } from "@/lib/text/match";

export interface QuoteCheck {
  verified: boolean;
  /** Turn the quote was actually found in (may differ from what the model claimed). */
  turn_idx: number;
  /** Verbatim text as it appears in the transcript (snapped), or the original if unverified. */
  quote: string;
  score: number;
  relocated: boolean;
}

/**
 * Verify, in code, that a quote spoken by `role` actually appears in the
 * transcript. The claimed turn is tried first, then the nearest other turns of
 * the same role. Returns the verbatim transcript text when found.
 */
export function verifyQuote(
  quote: string,
  claimedTurnIdx: number,
  turns: Turn[],
  role: Role = "interviewee",
): QuoteCheck {
  const candidates = turns
    .filter((t) => t.role === role)
    .sort((a, b) => Math.abs(a.idx - claimedTurnIdx) - Math.abs(b.idx - claimedTurnIdx));
  let bestScore = 0;
  for (const t of candidates) {
    const m = findQuote(quote, t.text);
    bestScore = Math.max(bestScore, m.score);
    if (m.matched) {
      return {
        verified: true,
        turn_idx: t.idx,
        quote: m.text,
        score: m.score,
        relocated: t.idx !== claimedTurnIdx,
      };
    }
  }
  return { verified: false, turn_idx: claimedTurnIdx, quote, score: bestScore, relocated: false };
}

/**
 * Work out which interviewee turns a verified leading question may have tainted.
 * The model's suggestion is only accepted if it points at interviewee turns
 * shortly after the question; otherwise we fall back to the next answer.
 */
export function resolveTaintedTurns(
  questionTurnIdx: number,
  suggested: number[],
  turns: Turn[],
): number[] {
  const after = turns.filter((t) => t.idx > questionTurnIdx && t.role === "interviewee");
  const nextAnswer = after[0];
  const window = after.slice(0, 3).map((t) => t.idx);
  const ok = suggested.filter((i) => window.includes(i));
  if (ok.length) return [...new Set(ok)].sort((a, b) => a - b);
  return nextAnswer ? [nextAnswer.idx] : [];
}

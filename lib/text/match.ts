/**
 * Quote verification primitives. Deliberately LLM-free: this is the
 * anti-hallucination guarantee. A quote is "verified" only if it (fuzzily)
 * appears in the source transcript text.
 */

export interface Word {
  w: string;
  start: number;
  end: number;
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Lowercase + unify apostrophes; one char -> one char so offsets stay valid. */
function canon(s: string): string {
  return s.replace(/[’‘‛`]/g, "'").toLowerCase();
}

export function tokenize(text: string): Word[] {
  const c = canon(text);
  const out: Word[] = [];
  for (const m of c.matchAll(WORD_RE)) {
    out.push({ w: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** Whitespace/punctuation/case-insensitive normal form (used for comparisons). */
export function normalizeText(s: string): string {
  return tokenize(s)
    .map((t) => t.w)
    .join(" ");
}

function wordEditDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

export interface QuoteMatch {
  matched: boolean;
  exact: boolean;
  /** 0..1 similarity of the best window. */
  score: number;
  /** Offsets into the original haystack (valid when matched). */
  start: number;
  end: number;
  /** Verbatim text from the haystack (what we display/store). */
  text: string;
}

const NO_MATCH: QuoteMatch = { matched: false, exact: false, score: 0, start: 0, end: 0, text: "" };

export const DEFAULT_THRESHOLD = 0.88;

/**
 * Find `quote` inside `haystack`.
 * - exact word-sequence match (ignoring case, punctuation, whitespace) -> score 1
 * - otherwise a word-level fuzzy window match accepted at >= threshold
 * - quotes shorter than 3 words must match exactly
 */
export function findQuote(
  quote: string,
  haystack: string,
  threshold: number = DEFAULT_THRESHOLD,
): QuoteMatch {
  const q = tokenize(quote).map((t) => t.w);
  const hw = tokenize(haystack);
  if (q.length === 0 || hw.length === 0) return NO_MATCH;
  const h = hw.map((t) => t.w);

  // 1. exact subsequence
  outer: for (let i = 0; i + q.length <= h.length; i++) {
    for (let k = 0; k < q.length; k++) if (h[i + k] !== q[k]) continue outer;
    const start = hw[i].start;
    const end = hw[i + q.length - 1].end;
    return { matched: true, exact: true, score: 1, start, end, text: haystack.slice(start, end) };
  }
  if (q.length < 3) return NO_MATCH;

  // 2. fuzzy window search; only try starts whose word occurs in the quote
  const qset = new Set(q);
  let best: { score: number; i: number; len: number } | null = null;
  const minLen = Math.max(1, Math.floor(q.length * 0.8));
  const maxLen = Math.ceil(q.length * 1.2);
  for (let i = 0; i < h.length; i++) {
    if (!qset.has(h[i])) continue;
    for (let len = minLen; len <= maxLen && i + len <= h.length; len++) {
      const win = h.slice(i, i + len);
      const d = wordEditDistance(q, win);
      const score = 1 - d / Math.max(q.length, len);
      if (!best || score > best.score) best = { score, i, len };
    }
  }
  if (best && best.score >= threshold) {
    const start = hw[best.i].start;
    const end = hw[best.i + best.len - 1].end;
    return {
      matched: true,
      exact: false,
      score: best.score,
      start,
      end,
      text: haystack.slice(start, end),
    };
  }
  return { ...NO_MATCH, score: best?.score ?? 0 };
}

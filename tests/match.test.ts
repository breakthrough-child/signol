import { describe, expect, it } from "vitest";
import { findQuote, normalizeText } from "@/lib/text/match";
import { verifyQuote, resolveTaintedTurns } from "@/lib/verify";
import type { Turn } from "@/lib/types";

const turns: Turn[] = [
  { idx: 0, speaker: "Q", role: "interviewer", text: "How do you track stock today?" },
  { idx: 1, speaker: "Bola", role: "interviewee", text: "We write every delivery in a notebook each night.  My sister spends about an hour on it, honestly." },
  { idx: 2, speaker: "Q", role: "interviewer", text: "Wouldn't it be great if an app did that?" },
  { idx: 3, speaker: "Bola", role: "interviewee", text: "Oh yes, I’d definitely pay for that. Great idea!" },
  { idx: 4, speaker: "Q", role: "interviewer", text: "Anything else?" },
  { idx: 5, speaker: "Bola", role: "interviewee", text: "Not really." },
];

describe("normalizeText", () => {
  it("ignores case, punctuation, whitespace and curly quotes", () => {
    expect(normalizeText("  I’d  PAY, for that!! ")).toBe("i'd pay for that");
  });
});

describe("findQuote", () => {
  it("finds exact quotes regardless of whitespace/punctuation and returns verbatim text", () => {
    const m = findQuote("we write every delivery in a notebook each night", turns[1].text);
    expect(m.matched).toBe(true);
    expect(m.exact).toBe(true);
    expect(m.text).toBe("We write every delivery in a notebook each night");
  });

  it("matches across a double space", () => {
    const m = findQuote("each night. My sister spends about an hour", turns[1].text);
    expect(m.matched).toBe(true);
  });

  it("accepts a small paraphrase drift via fuzzy matching but returns the real text", () => {
    const m = findQuote("We write every delivery into a notebook each night", turns[1].text);
    expect(m.matched).toBe(true);
    expect(m.exact).toBe(false);
    expect(m.text).toContain("in a notebook");
  });

  it("rejects hallucinated quotes", () => {
    const m = findQuote("We use a spreadsheet and WhatsApp to track all our stock", turns[1].text);
    expect(m.matched).toBe(false);
  });

  it("requires exact match for very short quotes", () => {
    expect(findQuote("not really", turns[5].text).matched).toBe(true);
    expect(findQuote("not ever", turns[5].text).matched).toBe(false);
  });

  it("handles empty input", () => {
    expect(findQuote("", "abc").matched).toBe(false);
    expect(findQuote("abc", "").matched).toBe(false);
  });
});

describe("verifyQuote", () => {
  it("verifies a quote in the claimed turn", () => {
    const r = verifyQuote("I'd definitely pay for that", 3, turns);
    expect(r.verified).toBe(true);
    expect(r.turn_idx).toBe(3);
    expect(r.relocated).toBe(false);
  });

  it("relocates a quote that is in a different interviewee turn", () => {
    const r = verifyQuote("I'd definitely pay for that", 1, turns);
    expect(r.verified).toBe(true);
    expect(r.turn_idx).toBe(3);
    expect(r.relocated).toBe(true);
  });

  it("does not let an interviewee quote match interviewer text", () => {
    const r = verifyQuote("How do you track stock today", 1, turns);
    expect(r.verified).toBe(false);
  });

  it("verifies interviewer quotes against interviewer turns", () => {
    const r = verifyQuote("Wouldn't it be great if an app did that?", 2, turns, "interviewer");
    expect(r.verified).toBe(true);
  });

  it("flags fabricated quotes", () => {
    const r = verifyQuote("I spent fifty thousand naira on QuickBooks last year", 1, turns);
    expect(r.verified).toBe(false);
  });
});

describe("resolveTaintedTurns", () => {
  it("accepts suggested turns inside the next-3-answers window", () => {
    expect(resolveTaintedTurns(2, [3, 5], turns)).toEqual([3, 5]);
  });
  it("falls back to the next answer when the suggestion is invalid", () => {
    expect(resolveTaintedTurns(2, [0, 99], turns)).toEqual([3]);
  });
});

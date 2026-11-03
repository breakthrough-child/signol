import { describe, expect, it } from "vitest";
import { computeCalibration, computeScore, statementWeight, strengthOf, TAINT_MULTIPLIER } from "@/lib/scoring";
import type { ScoredStatement } from "@/lib/types";

let n = 0;
const st = (over: Partial<ScoredStatement>): ScoredStatement => ({
  id: `s${++n}`,
  interview_id: "i1",
  type: "past_behavior",
  stance: "supports",
  verified: true,
  tainted: false,
  ...over,
});
const interviews = [
  { id: "i1", label: "Interview 1" },
  { id: "i2", label: "Interview 2" },
];

describe("weights", () => {
  it("orders weights past_behavior > current_pain > promise > opinion > compliment", () => {
    const w = (t: ScoredStatement["type"]) => statementWeight(t, false);
    expect(w("past_behavior")).toBeGreaterThan(w("current_pain"));
    expect(w("current_pain")).toBeGreaterThan(w("future_promise"));
    expect(w("future_promise")).toBeGreaterThan(w("opinion_general"));
    expect(w("opinion_general")).toBeGreaterThan(w("compliment"));
    expect(w("compliment")).toBe(0);
  });
  it("down-weights tainted statements", () => {
    expect(statementWeight("past_behavior", true)).toBe(TAINT_MULTIPLIER);
  });
  it("maps weights to strength labels", () => {
    expect(strengthOf(1)).toBe("strong");
    expect(strengthOf(0.7)).toBe("medium");
    expect(strengthOf(0.25)).toBe("weak");
    expect(strengthOf(0)).toBe("none");
  });
});

describe("computeScore", () => {
  const statements = [
    st({ type: "compliment", stance: "supports" }),
    st({ type: "compliment", stance: "neutral" }),
    st({ type: "future_promise", stance: "supports" }),
    st({ type: "future_promise", stance: "supports", interview_id: "i2" }),
    st({ type: "past_behavior", stance: "supports" }),
    st({ type: "past_behavior", stance: "contradicts", interview_id: "i2" }),
    st({ type: "current_pain", stance: "supports", tainted: true }),
    st({ type: "past_behavior", stance: "supports", verified: false }),
    st({ type: "irrelevant", stance: "neutral" }),
  ];
  const r = computeScore(statements, interviews);

  it("excludes unverified and irrelevant statements", () => {
    expect(r.verifiedCount).toBe(7);
    expect(r.unverifiedCount).toBe(1);
  });
  it("computes the share of positive feedback that is not evidence", () => {
    // positive = 2 compliments + 2 promises + 1 pb + 1 tainted pain = 6; 4 of them are not evidence
    expect(r.positiveSounding.total).toBe(6);
    expect(r.positiveSounding.pctNotEvidence).toBe(67);
    expect(r.headline).toContain("67%");
  });
  it("counts strong evidence for and against, ignoring tainted statements", () => {
    expect(r.strongFor).toBe(1);
    expect(r.strongAgainst).toBe(1);
    expect(r.tainted).toBe(1);
  });
  it("determines evidence-based supporters per interview", () => {
    const p1 = r.perInterview.find((p) => p.interviewId === "i1")!;
    const p2 = r.perInterview.find((p) => p.interviewId === "i2")!;
    expect(p1.supports).toBe(true);
    expect(p2.supports).toBe(false);
    expect(r.supporters).toBe(1);
  });
  it("is deterministic", () => {
    expect(computeScore(statements, interviews)).toEqual(r);
  });
  it("handles empty input", () => {
    const e = computeScore([], interviews);
    expect(e.headline).toMatch(/No verified evidence/);
    expect(e.supporters).toBe(0);
  });
});

describe("computeCalibration", () => {
  const score = computeScore([st({}), st({ interview_id: "i2" })], interviews);
  it("describes a gap neutrally", () => {
    const c = computeCalibration(5, 80, { ...score, interviewCount: 6 });
    expect(c.gap).toBe(3);
    expect(c.reflection).toContain("predicted 5 of 6");
    expect(c.reflection).not.toMatch(/wrong|bad|failed/i);
  });
  it("handles an exact match and an underestimate", () => {
    expect(computeCalibration(2, 50, score).gap).toBe(0);
    expect(computeCalibration(1, 50, score).reflection).toContain("more than you expected");
  });
});

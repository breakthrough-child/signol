import { describe, expect, it } from "vitest";
import { checkFriction, decisionLogToMarkdown, isRealResponse, type DecisionLog } from "@/lib/decision";
import { computeCalibration, computeScore } from "@/lib/scoring";

describe("friction by design", () => {
  const forIds = ["f1", "f2", "f3"];
  const againstIds = ["a1", "a2", "a3"];
  const resp = (ids: string[], text = "I had not considered that, it worries me.") => ids.map((statement_id) => ({ statement_id, response: text }));

  it("validated requires a response to every counter-evidence card", () => {
    expect(checkFriction("validated", forIds, againstIds, resp(forIds)).ok).toBe(false);
    expect(checkFriction("validated", forIds, againstIds, resp(["a1", "a2"])).missing).toEqual(["a3"]);
    expect(checkFriction("validated", forIds, againstIds, resp(againstIds)).ok).toBe(true);
  });
  it("invalidated requires a response to every supporting card", () => {
    expect(checkFriction("invalidated", forIds, againstIds, resp(againstIds)).ok).toBe(false);
    expect(checkFriction("invalidated", forIds, againstIds, resp(forIds)).ok).toBe(true);
  });
  it("need_more_evidence has no friction", () => {
    expect(checkFriction("need_more_evidence", forIds, againstIds, []).ok).toBe(true);
  });
  it("rejects empty, whitespace and filler responses", () => {
    expect(isRealResponse("")).toBe(false);
    expect(isRealResponse("   ")).toBe(false);
    expect(isRealResponse("ok")).toBe(false);
    expect(isRealResponse("...")).toBe(false);
    expect(isRealResponse("This contradicts my assumption.")).toBe(true);
    expect(checkFriction("validated", [], againstIds, resp(againstIds, "n/a")).ok).toBe(false);
  });
  it("requires nothing when there are no cards", () => {
    expect(checkFriction("validated", forIds, [], []).ok).toBe(true);
  });
});

describe("decisionLogToMarkdown", () => {
  it("renders the decision, prediction, evidence, responses and calibration", () => {
    const score = computeScore([], [{ id: "i", label: "I1" }]);
    const log: DecisionLog = {
      version: 1,
      project: { name: "Lagos", hypothesis: "Owners will pay", target_customer: "Owners", is_demo: false },
      prediction: { supporters: 5, confidence: 80, lockedAt: "2026-01-01T10:00:00Z" },
      analysis: { source: "live", interviews: 6, quotesVerified: 9, quotesTotal: 10 },
      evidence: { headline: "62% of positive feedback was compliments.", score },
      topFor: [{ id: "1", quote: "We use a notebook", interview: "I1", type: "past_behavior", stance: "supports", strength: "strong", tainted: false, why: "Concrete routine" }],
      topAgainst: [],
      themes: [{ title: "T", summary: "S" }],
      openQuestions: ["Who pays?"],
      responses: [{ side: "against", quote: "q", interview: "I2", response: "It worries me." }],
      choice: "need_more_evidence",
      calibration: computeCalibration(5, 80, score),
      decidedAt: "2026-01-02T10:00:00Z",
    };
    const md = decisionLogToMarkdown(log);
    expect(md).toContain("# Decision log: Lagos");
    expect(md).toContain("Need more evidence");
    expect(md).toContain("predicted **5 of 6**");
    expect(md).toContain("“We use a notebook”");
    expect(md).toContain("It worries me.");
    expect(md).toContain("9/10 quotes verified");
  });
});

import { describe, expect, it } from "vitest";
import { aggregate, groupRunLogs, normalizeRow, projectTimes } from "@/lib/stats";

describe("projectTimes", () => {
  it("computes analysis, board and decision times from timing events", () => {
    const t = projectTimes([
      { event: "analysis_started", at: "2026-01-01T10:00:00Z", meta: {} },
      { event: "analysis_finished", at: "2026-01-01T10:01:30Z", meta: {} },
      { event: "board_viewed", at: "2026-01-01T10:05:00Z", meta: { seconds: 120 } },
      { event: "board_viewed", at: "2026-01-01T10:09:00Z", meta: { seconds: 45 } },
      { event: "decision_made", at: "2026-01-01T10:12:00Z", meta: {} },
    ]);
    expect(t.analysisSeconds).toBe(90);
    expect(t.boardSeconds).toBe(165);
    expect(t.timeToDecisionSeconds).toBe(720);
  });
  it("returns nulls for an unfinished run", () => {
    const t = projectTimes([{ event: "analysis_started", at: "2026-01-01T10:00:00Z", meta: null }]);
    expect(t.analysisSeconds).toBeNull();
    expect(t.timeToDecisionSeconds).toBeNull();
    expect(t.boardSeconds).toBe(0);
  });
});

const row = (o: Record<string, unknown>) => normalizeRow({ model_calls: 0, failed_calls: 0, tokens_in: 0, tokens_out: 0, ...o });

describe("aggregate", () => {
  const rows = [
    row({ analysis_source: "live", analysis_seconds: 60, board_seconds: 100, time_to_decision_seconds: 600, model_calls: 15, tokens_in: 30000, tokens_out: 9000, benchmark_manual_minutes: 480 }),
    row({ analysis_source: "live", analysis_seconds: 100, board_seconds: 200, time_to_decision_seconds: 900, model_calls: 17, tokens_in: 34000, tokens_out: 11000 }),
    row({ analysis_source: "cached", analysis_seconds: 1, board_seconds: 0, time_to_decision_seconds: 300, model_calls: 0 }),
  ];
  const a = aggregate(rows);
  it("averages live-model numbers over live runs only", () => {
    expect(a.runs).toBe(3);
    expect(a.liveRuns).toBe(2);
    expect(a.cachedRuns).toBe(1);
    expect(a.avgAnalysisSeconds).toBe(80);
    expect(a.avgCallsPerRun).toBe(16);
    expect(a.avgTokensInPerRun).toBe(32000);
  });
  it("averages board and decision time and ignores zero board time", () => {
    expect(a.avgBoardSeconds).toBe(150);
    expect(a.avgTimeToDecisionSeconds).toBe(600);
  });
  it("compares manual benchmark with assisted time", () => {
    expect(a.benchmark).toMatchObject({ n: 1, avgManualMinutes: 480, avgAssistedMinutes: 10 });
    expect(a.benchmark!.pctSaved).toBe(98);
  });
  it("is null-safe for no runs", () => {
    const e = aggregate([]);
    expect(e.runs).toBe(0);
    expect(e.avgAnalysisSeconds).toBeNull();
    expect(e.benchmark).toBeNull();
  });
});

describe("groupRunLogs", () => {
  it("groups by provider/model/step, folds re-asks and counts failures", () => {
    const g = groupRunLogs([
      { step: "classify", provider: "groq", model: "m", tokens_in: 100, tokens_out: 50, latency_ms: 1000, ok: true },
      { step: "classify:reask", provider: "groq", model: "m", tokens_in: 120, tokens_out: 60, latency_ms: 2000, ok: true },
      { step: "classify", provider: "groq", model: "", tokens_in: 0, tokens_out: 0, latency_ms: 0, ok: false },
    ]);
    expect(g).toHaveLength(2);
    const ok = g.find((x) => x.model === "m")!;
    expect(ok).toMatchObject({ calls: 2, tokensIn: 220, tokensOut: 110, avgLatencyMs: 1500 });
    expect(g.find((x) => x.model === "")!.failed).toBe(1);
  });
});

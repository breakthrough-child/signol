/** Pure aggregation for the time-saved instrumentation (/stats and the outputs page). */

export interface TimingEventLite {
  event: string;
  at: string;
  meta: { seconds?: number } | null;
}

export interface ProjectTimes {
  analysisSeconds: number | null;
  boardSeconds: number;
  timeToDecisionSeconds: number | null;
}

export function projectTimes(events: TimingEventLite[]): ProjectTimes {
  const t = (name: string, pick: "min" | "max") => {
    const xs = events.filter((e) => e.event === name).map((e) => Date.parse(e.at));
    if (!xs.length) return null;
    return pick === "min" ? Math.min(...xs) : Math.max(...xs);
  };
  const start = t("analysis_started", "min");
  const end = t("analysis_finished", "max");
  const decided = t("decision_made", "max");
  return {
    analysisSeconds: start !== null && end !== null ? Math.max(0, (end - start) / 1000) : null,
    boardSeconds: events.filter((e) => e.event === "board_viewed").reduce((n, e) => n + (e.meta?.seconds ?? 0), 0),
    timeToDecisionSeconds: start !== null && decided !== null ? Math.max(0, (decided - start) / 1000) : null,
  };
}

export interface StatsRow {
  is_demo: boolean;
  analysis_seconds: number | null;
  board_seconds: number | null;
  time_to_decision_seconds: number | null;
  model_calls: number;
  failed_calls: number;
  tokens_in: number;
  tokens_out: number;
  benchmark_manual_minutes: number | null;
  analysis_source: "live" | "cached" | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function normalizeRow(r: Record<string, unknown>): StatsRow {
  return {
    is_demo: Boolean(r.is_demo),
    analysis_seconds: num(r.analysis_seconds),
    board_seconds: num(r.board_seconds),
    time_to_decision_seconds: num(r.time_to_decision_seconds),
    model_calls: Number(r.model_calls ?? 0),
    failed_calls: Number(r.failed_calls ?? 0),
    tokens_in: Number(r.tokens_in ?? 0),
    tokens_out: Number(r.tokens_out ?? 0),
    benchmark_manual_minutes: num(r.benchmark_manual_minutes),
    analysis_source: (r.analysis_source as StatsRow["analysis_source"]) ?? null,
  };
}

export interface Aggregate {
  runs: number;
  liveRuns: number;
  cachedRuns: number;
  decidedRuns: number;
  avgAnalysisSeconds: number | null;
  avgBoardSeconds: number | null;
  avgTimeToDecisionSeconds: number | null;
  avgCallsPerRun: number | null;
  avgTokensInPerRun: number | null;
  avgTokensOutPerRun: number | null;
  failedCalls: number;
  benchmark: { n: number; avgManualMinutes: number; avgAssistedMinutes: number; avgSavedMinutes: number; pctSaved: number } | null;
}

/** Live-model numbers (analysis time, calls, tokens) come from live runs only; cached runs would skew them. */
export function aggregate(rows: StatsRow[]): Aggregate {
  const live = rows.filter((r) => r.analysis_source === "live");
  const decided = rows.filter((r) => r.time_to_decision_seconds !== null);
  const bench = rows.filter((r) => r.benchmark_manual_minutes !== null && r.time_to_decision_seconds !== null);
  let benchmark: Aggregate["benchmark"] = null;
  if (bench.length) {
    const manual = avg(bench.map((r) => r.benchmark_manual_minutes!))!;
    const assisted = avg(bench.map((r) => r.time_to_decision_seconds! / 60))!;
    benchmark = {
      n: bench.length,
      avgManualMinutes: manual,
      avgAssistedMinutes: assisted,
      avgSavedMinutes: manual - assisted,
      pctSaved: manual > 0 ? Math.round(((manual - assisted) / manual) * 100) : 0,
    };
  }
  return {
    runs: rows.length,
    liveRuns: live.length,
    cachedRuns: rows.filter((r) => r.analysis_source === "cached").length,
    decidedRuns: decided.length,
    avgAnalysisSeconds: avg(live.map((r) => r.analysis_seconds).filter((x): x is number => x !== null)),
    avgBoardSeconds: avg(rows.map((r) => r.board_seconds).filter((x): x is number => x !== null && x > 0)),
    avgTimeToDecisionSeconds: avg(decided.map((r) => r.time_to_decision_seconds!)),
    avgCallsPerRun: avg(live.map((r) => r.model_calls)),
    avgTokensInPerRun: avg(live.map((r) => r.tokens_in)),
    avgTokensOutPerRun: avg(live.map((r) => r.tokens_out)),
    failedCalls: rows.reduce((n, r) => n + r.failed_calls, 0),
    benchmark,
  };
}

export interface RunLogLite {
  step: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
}

export interface CallGroup {
  provider: string;
  model: string;
  step: string;
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  avgLatencyMs: number;
}

export function groupRunLogs(logs: RunLogLite[]): CallGroup[] {
  const map = new Map<string, CallGroup & { lat: number; okCalls: number }>();
  for (const l of logs) {
    const step = l.step.replace(/:reask$/, "");
    const key = `${l.provider}|${l.model}|${step}`;
    const g = map.get(key) ?? { provider: l.provider, model: l.model, step, calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, avgLatencyMs: 0, lat: 0, okCalls: 0 };
    if (l.ok) {
      g.calls++;
      g.okCalls++;
      g.lat += l.latency_ms;
    } else g.failed++;
    g.tokensIn += l.tokens_in;
    g.tokensOut += l.tokens_out;
    map.set(key, g);
  }
  return [...map.values()]
    .map(({ lat, okCalls, ...g }) => ({ ...g, avgLatencyMs: okCalls ? Math.round(lat / okCalls) : 0 }))
    .sort((a, b) => a.step.localeCompare(b.step) || a.provider.localeCompare(b.provider));
}

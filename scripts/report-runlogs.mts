/**
 * Prints per-step model-call statistics from `run_logs` as Markdown, for docs/AI_DISCLOSURE.md and
 * docs/TIME_SAVED_REPORT.md. Works against any Postgres that holds the signol schema
 * (your Supabase connection string, or the local stack).
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/report-runlogs.mts [--source live|cached|all] [--demo]
 */
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (Supabase: Project settings > Database > Connection string).");
  process.exit(1);
}
const demoOnly = process.argv.includes("--demo");
const pool = new pg.Pool({ connectionString: url });

const projects = (
  await pool.query(
    `select id, analysis_source, is_demo from projects where analysis_source = 'live' ${demoOnly ? "and is_demo" : ""} order by created_at desc`,
  )
).rows;
if (!projects.length) {
  console.log("No live analysis runs found.");
  process.exit(0);
}
const ids = projects.map((p) => p.id);
const rows = (
  await pool.query(
    `select regexp_replace(step, ':reask$', '') as step, provider, model, count(*) filter (where ok) as calls,
            count(*) filter (where not ok) as failed, sum(tokens_in) as tin, sum(tokens_out) as tout,
            round(avg(latency_ms) filter (where ok)) as avg_ms
       from run_logs where project_id = any($1) group by 1,2,3 order by 1,2`,
    [ids],
  )
).rows;
const n = projects.length;
console.log(`Live runs measured: ${n}\n`);
console.log("| Step | Provider | Model | Calls/run | Failed (total) | Tokens in/run | Tokens out/run | Avg latency (ms) |");
console.log("|---|---|---|---|---|---|---|---|");
let calls = 0, tin = 0, tout = 0;
for (const r of rows) {
  calls += Number(r.calls); tin += Number(r.tin); tout += Number(r.tout);
  console.log(`| ${r.step} | ${r.provider} | ${r.model || "n/a"} | ${(Number(r.calls) / n).toFixed(1)} | ${r.failed} | ${Math.round(Number(r.tin) / n)} | ${Math.round(Number(r.tout) / n)} | ${r.avg_ms ?? "n/a"} |`);
}
console.log(`\nTotal per run: ${(calls / n).toFixed(1)} model calls, ${Math.round(tin / n)} tokens in, ${Math.round(tout / n)} tokens out.`);
await pool.end();

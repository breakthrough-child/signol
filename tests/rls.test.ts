/**
 * Row Level Security tests. They run against whatever Supabase the env points to:
 *   - local:  `node scripts/local-stack/stack.mjs up` (real Postgres + the real migrations)
 *   - hosted: a Supabase project with the migrations applied (anonymous sign-ins enabled)
 * Skipped automatically when no backend is reachable.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function reachable() {
  if (!url || !key) return false;
  try {
    const r = await fetch(`${url}/rest/v1/projects?limit=1`, { headers: { apikey: key } });
    return r.status < 500;
  } catch {
    return false;
  }
}

const up = await reachable();

async function anonUser(): Promise<{ db: SupabaseClient; id: string }> {
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error("no user");
  return { db, id: data.user.id };
}

describe.skipIf(!up)("RLS: one anonymous user cannot touch another's data", () => {
  let A: { db: SupabaseClient; id: string };
  let B: { db: SupabaseClient; id: string };
  let projectId: string;
  let interviewId: string;

  beforeAll(async () => {
    A = await anonUser();
    B = await anonUser();
    const p = await A.db
      .from("projects")
      .insert({ name: "A", hypothesis: "Restaurants will pay for X", target_customer: "owners", predicted_supporters: 3, predicted_confidence: 70 })
      .select()
      .single();
    expect(p.error).toBeNull();
    projectId = p.data!.id;
    expect(p.data!.owner_id).toBe(A.id);
    const i = await A.db.from("interviews").insert({ project_id: projectId, label: "I1", source_type: "paste", raw_text: "secret transcript" }).select().single();
    expect(i.error).toBeNull();
    interviewId = i.data!.id;
    await A.db.from("statements").insert({ project_id: projectId, interview_id: interviewId, turn_idx: 1, type: "past_behavior", stance: "supports", quote: "secret quote", rationale: "r", verified: true });
  });

  it("owner can read their own rows", async () => {
    const r = await A.db.from("projects").select("*").eq("id", projectId);
    expect(r.data).toHaveLength(1);
  });

  it("another user sees nothing in any table", async () => {
    for (const t of ["projects", "interviews", "turns", "statements", "leading_questions", "syntheses", "decisions", "run_logs", "timing_events", "pipeline_steps"]) {
      const r = await B.db.from(t).select("*");
      expect(r.error, t).toBeNull();
      expect(r.data, t).toEqual([]);
    }
  });

  it("another user cannot read by id", async () => {
    const r = await B.db.from("interviews").select("*").eq("id", interviewId);
    expect(r.data).toEqual([]);
  });

  it("another user cannot update or delete (0 rows affected)", async () => {
    const u = await B.db.from("projects").update({ name: "pwned" }).eq("id", projectId).select();
    expect(u.data ?? []).toHaveLength(0);
    const d = await B.db.from("projects").delete().eq("id", projectId).select();
    expect(d.data ?? []).toHaveLength(0);
    const still = await A.db.from("projects").select("name").eq("id", projectId).single();
    expect(still.data!.name).toBe("A");
  });

  it("another user cannot attach rows to someone else's project", async () => {
    const r = await B.db.from("interviews").insert({ project_id: projectId, label: "evil", source_type: "paste", raw_text: "x" });
    expect(r.error).not.toBeNull();
  });

  it("cannot insert rows owned by someone else", async () => {
    const r = await B.db.from("projects").insert({ owner_id: A.id, name: "x", hypothesis: "hypothesis here", target_customer: "tc", predicted_supporters: 1, predicted_confidence: 10 });
    expect(r.error).not.toBeNull();
  });

  it("an unauthenticated client sees nothing", async () => {
    const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await anon.from("projects").select("*");
    expect(r.data ?? []).toEqual([]);
    const ins = await anon.from("projects").insert({ name: "x", hypothesis: "hypothesis here", target_customer: "tc", predicted_supporters: 1, predicted_confidence: 10 });
    expect(ins.error).not.toBeNull();
  });

  it("Checkpoint 1: hypothesis and prediction are immutable once locked", async () => {
    const ok = await A.db.from("projects").update({ hypothesis: "Edited before lock is fine" }).eq("id", projectId);
    expect(ok.error).toBeNull();
    const lock = await A.db.from("projects").update({ locked_at: new Date().toISOString(), status: "locked" }).eq("id", projectId);
    expect(lock.error).toBeNull();
    const edit = await A.db.from("projects").update({ hypothesis: "Changed my mind after seeing evidence" }).eq("id", projectId);
    expect(edit.error?.message).toMatch(/locked/i);
    const pred = await A.db.from("projects").update({ predicted_supporters: 6 }).eq("id", projectId);
    expect(pred.error?.message).toMatch(/locked/i);
    const unlock = await A.db.from("projects").update({ locked_at: null }).eq("id", projectId);
    expect(unlock.error).not.toBeNull();
  });

  it("decisions are immutable; share links expose only the frozen log", async () => {
    const log = { hypothesis: "H", choice: "need_more_evidence", note: "frozen snapshot" };
    const d = await A.db.from("decisions").insert({ project_id: projectId, choice: "need_more_evidence", responses: [], calibration: {}, log }).select().single();
    expect(d.error).toBeNull();
    const edit = await A.db.from("decisions").update({ choice: "validated" }).eq("id", d.data!.id);
    expect(edit.error?.message).toMatch(/cannot be edited/i);

    const token = "tok_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const share = await A.db.from("decisions").update({ share_token: token }).eq("id", d.data!.id);
    expect(share.error).toBeNull();

    const pub = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const ok = await pub.rpc("shared_decision_log", { p_token: token });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ hypothesis: "H", shared: true });
    const bad = await pub.rpc("shared_decision_log", { p_token: "nope" });
    expect(bad.data).toBeNull();
    // and the token does not open the tables
    const direct = await pub.from("decisions").select("*");
    expect(direct.data ?? []).toEqual([]);
    const other = await B.db.from("decisions").select("*");
    expect(other.data).toEqual([]);
  });

  it("stats_rows(p_all) returns anonymised numbers only", async () => {
    const r = await B.db.rpc("stats_rows", { p_all: true });
    expect(r.error).toBeNull();
    for (const row of (r.data ?? []) as Record<string, unknown>[]) {
      expect(Object.keys(row)).not.toContain("hypothesis");
      expect(Object.keys(row)).not.toContain("id");
    }
  });

  it("storage: another user cannot download or sign the owner's files", async () => {
    const path = `${A.id}/${projectId}/note.txt`;
    const up1 = await A.db.storage.from("interviews").upload(path, new Blob(["private audio stand-in"]), { upsert: true });
    if (up1.error) return; // storage not available in this backend
    const dl = await B.db.storage.from("interviews").download(path);
    expect(dl.error).not.toBeNull();
    const sign = await B.db.storage.from("interviews").createSignedUrl(path, 60);
    expect(sign.error).not.toBeNull();
    const mine = await A.db.storage.from("interviews").download(path);
    expect(mine.error).toBeNull();
    const intruder = await B.db.storage.from("interviews").upload(`${A.id}/${projectId}/evil.txt`, new Blob(["x"]));
    expect(intruder.error).not.toBeNull();
  });
});

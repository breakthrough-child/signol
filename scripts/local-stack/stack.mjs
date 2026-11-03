#!/usr/bin/env node
/**
 * Local development/test stack WITHOUT Docker. Real Postgres (with the real migrations and RLS)
 * behind a small HTTP shim that speaks just enough of Supabase Auth (anonymous sign-in),
 * Storage and the PostgREST query API (the subset supabase-js uses in signol).
 *
 * It is a stand-in for `supabase start` when Docker is unavailable. Production uses hosted
 * Supabase; this shim is never deployed. Every request runs inside a transaction with
 * `set local role` + `request.jwt.claims`, exactly how PostgREST applies RLS.
 *
 *   node scripts/local-stack/stack.mjs up      # start (applies migrations on first run)
 *   node scripts/local-stack/stack.mjs reset   # wipe data, re-apply migrations
 *   node scripts/local-stack/stack.mjs down
 */
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = process.env.SIGNOL_LOCAL_DIR || path.join(ROOT, ".local");
const PG_BIN = process.env.PG_BIN || "/usr/lib/postgresql/16/bin";
const PG_PORT = Number(process.env.LOCAL_PG_PORT || 54322);
const API_PORT = Number(process.env.LOCAL_API_PORT || 54321);
const JWT_SECRET = process.env.LOCAL_JWT_SECRET || "local-dev-only-jwt-secret-not-for-production-use";
const asRoot = process.getuid?.() === 0;
const PGUSER_OS = process.env.LOCAL_PG_OS_USER || "signolpg"; // Postgres refuses to run as root

const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = String(token || "").split(".");
  if (!h || !p || !s) return null;
  const exp = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  if (exp.length !== s.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(s))) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}
const far = 4102444800; // 2100-01-01
const ANON_KEY = sign({ role: "anon", iss: "signol-local", exp: far });

function run(cmd, args) {
  const [c, a] = asRoot ? ["runuser", ["-u", PGUSER_OS, "--", cmd, ...args]] : [cmd, args];
  return execFileSync(c, a, { stdio: "pipe", encoding: "utf8" });
}
const pgbin = (n) => path.join(PG_BIN, n);
const psql = (db, sqlOrFile, isFile = false) =>
  run(pgbin("psql"), ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", isFile ? "-f" : "-c", sqlOrFile]);

function ensureDirs() {
  for (const d of ["logs", "storage"]) fs.mkdirSync(path.join(DIR, d), { recursive: true });
  if (asRoot) execFileSync("chown", ["-R", PGUSER_OS, DIR]);
}
function pgRunning() {
  try {
    run(pgbin("pg_isready"), ["-h", "127.0.0.1", "-p", String(PG_PORT)]);
    return true;
  } catch {
    return false;
  }
}
function startPostgres() {
  const data = path.join(DIR, "pgdata");
  if (!fs.existsSync(path.join(data, "PG_VERSION"))) {
    run(pgbin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C.UTF-8"]);
  }
  if (!pgRunning()) {
    run(pgbin("pg_ctl"), ["-D", data, "-l", path.join(DIR, "logs", "postgres.log"), "-o", `-p ${PG_PORT} -h 127.0.0.1 -k ${DIR}`, "-w", "start"]);
  }
}
function dbExists() {
  try {
    return run(pgbin("psql"), ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "postgres", "-d", "postgres", "-tAc", "select 1 from pg_database where datname='signol_dev'"]).trim() === "1";
  } catch {
    return false;
  }
}
function applyMigrations() {
  psql("postgres", "drop database if exists signol_dev with (force)");
  psql("postgres", "create database signol_dev");
  psql("signol_dev", path.join(ROOT, "scripts/local-stack/bootstrap.sql"), true);
  const dir = path.join(ROOT, "supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) psql("signol_dev", path.join(dir, f), true);
}

/* ------------------------------------------------------------------ shim server */

async function startShim() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: `postgres://postgres@127.0.0.1:${PG_PORT}/signol_dev` });
  const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", ...headers });
    res.end(code === 204 ? undefined : JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
  const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer /i, "");
  const userJson = (u) => ({
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email ?? "", is_anonymous: u.is_anonymous,
    app_metadata: {}, user_metadata: {}, created_at: u.created_at,
  });
  const sessionFor = (user) => {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: sign({ aud: "authenticated", role: "authenticated", sub: user.id, is_anonymous: user.is_anonymous, iat: now, exp: now + 3600 }),
      refresh_token: sign({ typ: "refresh", sub: user.id, exp: far }),
      token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: userJson(user),
    };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
    const p = url.pathname;
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
        return res.end();
      }
      if (p === "/auth/v1/signup" && req.method === "POST") {
        const { rows } = await pool.query("insert into auth.users (is_anonymous) values (true) returning *");
        return json(res, 200, sessionFor(rows[0]));
      }
      if (p === "/auth/v1/token" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        const claims = verify(body.refresh_token);
        if (!claims || claims.typ !== "refresh") return json(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
        const { rows } = await pool.query("select * from auth.users where id = $1", [claims.sub]);
        if (!rows[0]) return json(res, 400, { error: "invalid_grant", error_description: "User not found" });
        return json(res, 200, sessionFor(rows[0]));
      }
      if (p === "/auth/v1/user" && req.method === "GET") {
        const claims = verify(bearer(req));
        if (!claims?.sub) return json(res, 401, { code: 401, msg: "invalid JWT" });
        const { rows } = await pool.query("select * from auth.users where id = $1", [claims.sub]);
        if (!rows[0]) return json(res, 401, { code: 401, msg: "user not found" });
        return json(res, 200, userJson(rows[0]));
      }
      if (p === "/auth/v1/logout") return json(res, 204, null);
      if (p.startsWith("/storage/v1/")) return await storage(req, res, url, p.slice("/storage/v1".length), readBody, json, bearer);
      if (p.startsWith("/rest/v1/")) return await rest(req, res, url, p.slice("/rest/v1/".length), pool, readBody, bearer, json);
      json(res, 404, { error: "not found", path: p });
    } catch (e) {
      console.error(e);
      json(res, 500, { error: String(e) });
    }
  });
  server.listen(API_PORT, "127.0.0.1", () => console.log(`shim listening on :${API_PORT}`));
}

/* ------------------------------------------------------------------ storage (files on disk) */

async function storage(req, res, url, p, readBody, json, bearer) {
  const root = path.join(DIR, "storage");
  const claims = verify(bearer(req));
  const safe = (rel) => {
    const full = path.join(root, rel);
    if (!full.startsWith(root + path.sep)) throw new Error("bad path");
    return full;
  };
  const ownerOk = (objPath) => claims?.role === "authenticated" && objPath.split("/")[0] === claims.sub;

  let m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/);
  if (m && req.method === "POST") {
    const [, bucket, obj] = m;
    if (!ownerOk(decodeURIComponent(obj))) return json(res, 403, { error: "forbidden" });
    const token = sign({ url: `${bucket}/${decodeURIComponent(obj)}`, exp: Math.floor(Date.now() / 1000) + 3600 });
    return json(res, 200, { signedURL: `/object/sign/${bucket}/${obj}?token=${token}` });
  }
  if (m && req.method === "GET") {
    const [, bucket, obj] = m;
    const t = verify(url.searchParams.get("token"));
    if (!t || t.url !== `${bucket}/${decodeURIComponent(obj)}`) return json(res, 401, { error: "invalid token" });
    const f = safe(`${bucket}/${decodeURIComponent(obj)}`);
    if (!fs.existsSync(f)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(fs.readFileSync(f));
  }
  m = p.match(/^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
  if (m) {
    const [, bucket, obj0] = m;
    const obj = decodeURIComponent(obj0);
    if (!ownerOk(obj)) return json(res, 403, { error: "forbidden", message: "new row violates row-level security policy" });
    const f = safe(`${bucket}/${obj}`);
    if (req.method === "POST" || req.method === "PUT") {
      const ct = req.headers["content-type"] || "";
      const raw = await readBody(req);
      let data = raw;
      if (ct.startsWith("multipart/form-data")) {
        const fd = await new Request("http://x/", { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
        const file = fd.get("") ?? fd.get("file") ?? [...fd.values()].find((v) => typeof v !== "string");
        data = Buffer.from(await file.arrayBuffer());
      }
      if (fs.existsSync(f) && req.headers["x-upsert"] !== "true") return json(res, 409, { error: "Duplicate", message: "The resource already exists" });
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, data);
      return json(res, 200, { Key: `${bucket}/${obj}`, Id: crypto.randomUUID() });
    }
    if (req.method === "GET") {
      if (!fs.existsSync(f)) return json(res, 404, { error: "not found", message: "Object not found" });
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(fs.readFileSync(f));
    }
    if (req.method === "DELETE") {
      fs.rmSync(f, { force: true });
      return json(res, 200, { message: "Successfully deleted" });
    }
  }
  m = p.match(/^\/object\/([^/]+)$/);
  if (m && req.method === "DELETE") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    for (const obj of body.prefixes ?? []) if (ownerOk(obj)) fs.rmSync(safe(`${m[1]}/${obj}`), { force: true });
    return json(res, 200, []);
  }
  return json(res, 404, { error: "not found" });
}

/* ------------------------------------------------------------------ mini PostgREST (subset) */

const IDENT = /^[a-z_][a-z0-9_]*$/;
const colTypes = new Map();
async function typesOf(pool, table) {
  if (!colTypes.has(table)) {
    const { rows } = await pool.query(
      "select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1",
      [table],
    );
    colTypes.set(table, Object.fromEntries(rows.map((r) => [r.column_name, r.data_type])));
  }
  return colTypes.get(table);
}
const isJsonType = (t) => t === "jsonb" || t === "json";
const perr = (status, code, message) => Object.assign(new Error(message), { status, pgrst: { code, message, details: null, hint: null } });

function buildWhere(url, params, cols) {
  const conds = [];
  const reserved = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
  for (const [k, v] of url.searchParams) {
    if (reserved.has(k)) continue;
    if (!IDENT.test(k) || !cols[k]) throw perr(400, "PGRST204", `Unknown column ${k}`);
    const m = v.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|in|is)\.(.*)$/s);
    if (!m) throw perr(400, "PGRST100", `Bad filter ${k}=${v}`);
    const [, neg, op, val] = m;
    let c;
    if (op === "is") {
      c = `"${k}" is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`;
    } else if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      params.push(list);
      c = `"${k}" = any($${params.length})`;
    } else {
      params.push(val);
      const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" }[op];
      c = `"${k}" ${sym} $${params.length}`;
    }
    conds.push(neg ? `not (${c})` : c);
  }
  return conds.length ? ` where ${conds.join(" and ")}` : "";
}

async function rest(req, res, url, rel, pool, readBody, bearer, json) {
  const claims = verify(bearer(req)) ?? verify(req.headers.apikey);
  const role = claims?.role === "authenticated" ? "authenticated" : claims?.role === "service_role" ? "service_role" : "anon";
  const prefer = String(req.headers.prefer || "");
  const wantsObject = String(req.headers.accept || "").includes("application/vnd.pgrst.object+json");
  const isRpc = rel.startsWith("rpc/");
  const target = isRpc ? rel.slice(4) : rel;
  if (!IDENT.test(target)) return json(res, 404, { code: "PGRST205", message: "not found" });
  const body = ["GET", "HEAD", "DELETE"].includes(req.method) ? null : JSON.parse((await readBody(req)).toString() || "null");
  const client = await pool.connect();
  const params = [];
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? {})]);

    if (isRpc) {
      const args = body ?? {};
      const names = Object.keys(args);
      names.forEach((n) => { if (!IDENT.test(n)) throw perr(400, "PGRST100", "bad argument name"); });
      const call = names.map((n) => {
        params.push(args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n]);
        return `"${n}" => $${params.length}`;
      }).join(", ");
      const result = await client.query(`select * from public."${target}"(${call})`, params);
      await client.query("commit");
      const rows = result.rows;
      if (rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === target) return json(res, 200, rows[0][target]);
      return json(res, 200, rows);
    }

    const cols = await typesOf(pool, target);
    if (!Object.keys(cols).length) throw perr(404, "PGRST205", `Could not find the table 'public.${target}'`);
    const sel = url.searchParams.get("select");
    const selectList = !sel || sel === "*" ? "*" : sel.split(",").map((c) => {
      if (!IDENT.test(c)) throw perr(400, "PGRST100", "unsupported select expression (embeds are not supported by the local shim)");
      return `"${c}"`;
    }).join(", ");
    const ret = prefer.includes("return=representation") ? selectList : null;
    const ser = (c, v) => (v !== null && typeof v === "object" && isJsonType(cols[c]) ? JSON.stringify(v) : v);

    if (req.method === "GET" || req.method === "HEAD") {
      const where = buildWhere(url, params, cols);
      let total = null;
      if (prefer.includes("count=exact")) {
        total = Number((await client.query(`select count(*) from public."${target}"${where}`, params)).rows[0].count);
      }
      let q = `select ${selectList} from public."${target}"${where}`;
      const order = url.searchParams.get("order");
      if (order) {
        q += " order by " + order.split(",").map((o) => {
          const [c, d = "asc", n] = o.split(".");
          if (!IDENT.test(c)) throw perr(400, "PGRST100", "bad order");
          return `"${c}" ${d === "desc" ? "desc" : "asc"}${n === "nullsfirst" ? " nulls first" : n === "nullslast" ? " nulls last" : ""}`;
        }).join(", ");
      }
      if (url.searchParams.get("limit")) q += ` limit ${Number(url.searchParams.get("limit"))}`;
      if (url.searchParams.get("offset")) q += ` offset ${Number(url.searchParams.get("offset"))}`;
      const result = await client.query(q, params);
      await client.query("commit");
      const headers = total !== null ? { "content-range": `${result.rows.length ? `0-${result.rows.length - 1}` : "*"}/${total}` } : {};
      if (wantsObject) {
        if (result.rows.length !== 1) {
          return json(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${result.rows.length} rows`, hint: null });
        }
        return json(res, 200, result.rows[0], headers);
      }
      return json(res, 200, req.method === "HEAD" ? [] : result.rows, headers);
    }

    let sql;
    let status;
    if (req.method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      keys.forEach((k) => { if (!IDENT.test(k) || !cols[k]) throw perr(400, "PGRST204", `Could not find the '${k}' column of '${target}' in the schema cache`); });
      const tuples = rows.map((r) => `(${keys.map((k) => {
        if (!(k in r)) return "default";
        params.push(ser(k, r[k]));
        return `$${params.length}`;
      }).join(", ")})`);
      sql = `insert into public."${target}" (${keys.map((k) => `"${k}"`).join(", ")}) values ${tuples.join(", ")}`;
      if (prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates")) {
        const oc = (url.searchParams.get("on_conflict") ?? "id").split(",").map((c) => `"${c}"`).join(", ");
        sql += prefer.includes("ignore-duplicates")
          ? ` on conflict (${oc}) do nothing`
          : ` on conflict (${oc}) do update set ${keys.map((k) => `"${k}" = excluded."${k}"`).join(", ")}`;
      }
      status = 201;
    } else if (req.method === "PATCH") {
      const keys = Object.keys(body);
      keys.forEach((k) => { if (!IDENT.test(k) || !cols[k]) throw perr(400, "PGRST204", `Could not find the '${k}' column of '${target}' in the schema cache`); });
      const sets = keys.map((k) => { params.push(ser(k, body[k])); return `"${k}" = $${params.length}`; });
      sql = `update public."${target}" set ${sets.join(", ")}${buildWhere(url, params, cols)}`;
      status = ret ? 200 : 204;
    } else if (req.method === "DELETE") {
      sql = `delete from public."${target}"${buildWhere(url, params, cols)}`;
      status = ret ? 200 : 204;
    } else throw perr(405, "PGRST117", "method not allowed");
    if (ret) sql += ` returning ${ret}`;
    const result = await client.query(sql, params);
    await client.query("commit");
    if (!ret) {
      res.writeHead(status, { "access-control-allow-origin": "*" });
      return res.end();
    }
    if (wantsObject) return json(res, status, result.rows[0] ?? null);
    return json(res, status, result.rows);
  } catch (e) {
    try { await client.query("rollback"); } catch {}
    if (e.pgrst) return json(res, e.status, e.pgrst);
    const code = e.code || "XX000";
    const http = code === "42501" ? (role === "anon" ? 401 : 403) : code.startsWith("23") ? 409 : code.startsWith("22") || code.startsWith("42") || code === "P0001" ? 400 : 500;
    return json(res, http, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ commands */

function printEnv() {
  console.log(`
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${API_PORT}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
DATABASE_URL=postgres://postgres@127.0.0.1:${PG_PORT}/signol_dev
`);
}
function killPid(file) {
  try {
    process.kill(Number(fs.readFileSync(path.join(DIR, file), "utf8")));
  } catch {}
}

const cmd = process.argv[2] || "up";
if (cmd === "down") {
  killPid("shim.pid");
  try { run(pgbin("pg_ctl"), ["-D", path.join(DIR, "pgdata"), "-m", "fast", "stop"]); } catch {}
  console.log("stopped");
} else if (cmd === "shim") {
  await startShim(); // internal: foreground HTTP shim
} else if (cmd === "up" || cmd === "reset") {
  ensureDirs();
  startPostgres();
  if (cmd === "reset" || !dbExists()) applyMigrations();
  killPid("shim.pid");
  const log = fs.openSync(path.join(DIR, "logs", "shim.log"), "a");
  const shim = spawn(process.execPath, [fileURLToPath(import.meta.url), "shim"], { detached: true, stdio: ["ignore", log, log], cwd: ROOT });
  shim.unref();
  fs.writeFileSync(path.join(DIR, "shim.pid"), String(shim.pid));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${API_PORT}/rest/v1/projects?limit=1`, { headers: { apikey: ANON_KEY } });
      if (r.status < 500) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("local stack is up");
  printEnv();
} else {
  console.error("usage: stack.mjs up|reset|down");
  process.exit(1);
}

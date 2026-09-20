// S1.5 — RLS isolation test.
// Creates two real Supabase users (A and B), each with their own project.
// Proves B cannot SELECT/INSERT/UPDATE/DELETE A's rows in ANY table, and that
// match_chunks (security invoker) also honors the boundary.
//
// Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY from apps/web/.env.local.
//
// Usage: node scripts/s1_5_isolation.mjs
// Exit code 0 = every (table x operation) check passed.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = readFileSync("apps/web/.env.local", "utf8");
const env = Object.fromEntries(
  envFile
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) throw new Error("missing Supabase env vars");

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const nunky = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const ts = Date.now();
const aEmail = `s15a${ts}@example.com`;
const bEmail = `s15b${ts}@example.com`;
const PW = `S15test!${ts}`;
const sha = (s) => {
  const c = (n, i) => ((n << i) | (n >>> (32 - i))) >>> 0;
  return `h-${Buffer.from(String(s)).toString("hex").slice(0, 24)}`;
};
// deterministic-ish 2048-dim vector as pgvector text
const vec = (seed) =>
  "[" +
  Array.from({ length: 2048 }, (_, i) => {
    const v = Math.sin(seed * (i + 1)) * 10000;
    return (v - Math.floor(v) - 0.5).toFixed(6);
  }).join(",") +
  "]";

const results = [];
let APP; // A's project id (set during seeding)
let PBP; // B's project id
const record = (table, op, ok, note = "") =>
  results.push({ table, op, ok: !!ok, note: String(note).slice(0, 120) });

const night = async (label, fn) => {
  try {
    const out = await fn();
    record(label, "setup", true);
    return out;
  } catch (e) {
    record(label, "setup", false, e.message);
    return null;
  }
};

// ---------- users ----------
const ua = await night("users", async () => {
  const { data, error } = await admin.auth.admin.createUser({ email: aEmail, password: PW, email_confirm: true });
  if (error) throw error;
  return data.user;
});
const ub = await night("users", async () => {
  const { data, error } = await admin.auth.admin.createUser({ email: bEmail, password: PW, email_confirm: true });
  if (error) throw error;
  return data.user;
});

const signIn = async (email) => {
  const c = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
};
const C_A = await signIn(aEmail);
const C_B = await signIn(bEmail);

await night("projects(A,B)", async () => {
  const a = await C_A.from("projects").insert({ owner_id: ua.id, name: "PA" }).select().single();
  if (a.error) throw a.error;
  APP = a.data.id;
  const b = await C_B.from("projects").insert({ owner_id: ub.id, name: "PB" }).select().single();
  if (b.error) throw b.error;
  PBP = b.data.id;
});

// A's tenant rows
await night("seed(A)", async () => {
  const evt = await C_A.from("events").insert({
    project_id: APP, user_id: ua.id, source_type: "note", platform: "manual",
    content: "alpha secret evidence", content_hash: sha(`ev${ts}`), metadata: { t: "s15" },
  }).select().single();
  if (evt.error) throw evt.error;
  const chk = await C_A.from("chunks").insert({
    event_id: evt.data.id, project_id: APP, chunk_index: 0, content: "alpha secret evidence",
    token_count: 40, embedding: vec(7),
  }).select().single();
  if (chk.error) throw chk.error;
  const ki = await C_A.from("knowledge_items").insert({
    project_id: APP, kind: "fact", subject_key: "alpha", statement: "alpha secret fact",
    embedding: vec(8), confidence: 0.9,
  }).select().single();
  if (ki.error) throw ki.error;
  const pl = await C_A.from("provenance_links").insert({
    project_id: APP, from_type: "chunk", from_id: chk.data.id,
    to_type: "knowledge_item", to_id: ki.data.id, relation: "supports",
  });
  if (pl.error) throw pl.error;
  const rp = await C_A.from("research_pages").insert({
    project_id: APP, user_id: ua.id, url: `https://a.example.com/${ts}`, domain: "a.example.com",
    title: "alpha page", snippet: "alpha",
  });
  if (rp.error) throw rp.error;
  const q = await C_A.from("queries").insert({
    project_id: APP, user_id: ua.id, client: "eval", question: "what is alpha?", answer: "alpha",
  });
  if (q.error) throw q.error;
  const tok = await C_A.from("api_tokens").insert({ user_id: ua.id, name: "alpha-key", token_hash: sha(`tok${ts}`) });
  if (tok.error) throw tok.error;
  const job = await admin
    .from("jobs") // service role (only way in; jobs is service-only)
    .insert({ project_id: APP, kind: "snapshot", payload: { p: ts } });
  if (job.error) throw job.error;
});

// ---------- CROSS-TENANT MATRIX: B operates on A's project ----------
const crossCases = [
  ["projects", "SELECT", () => C_B.from("projects").select("id").eq("id", APP)],
  ["projects", "INSERT", () => C_B.from("projects").insert({ owner_id: ua.id, name: "steal" }).select("id")],
  ["projects", "UPDATE", () => C_B.from("projects").update({ name: "hacked" }).eq("id", APP).select("id")],
  ["projects", "DELETE", () => C_B.from("projects").delete().eq("id", APP).select("id")],
  ["events", "SELECT", () => C_B.from("events").select("id").eq("project_id", APP)],
  ["events", "INSERT", () => C_B.from("events").insert({ project_id: APP, user_id: ub.id, source_type: "note", content: "evil", content_hash: sha(`e2${ts}`) }).select("id")],
  ["events", "UPDATE", () => C_B.from("events").update({ content: "evil" }).eq("project_id", APP).select("id")],
  ["events", "DELETE", () => C_B.from("events").delete().eq("project_id", APP).select("id")],
  ["chunks", "SELECT", () => C_B.from("chunks").select("id").eq("project_id", APP)],
  ["chunks", "INSERT", () => C_B.from("chunks").insert({ event_id: "0".repeat(36).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"), project_id: APP, chunk_index: 0, content: "evil", token_count: 1, embedding: vec(9) }).select("id")],
  ["chunks", "UPDATE", () => C_B.from("chunks").update({ content: "evil" }).eq("project_id", APP).select("id")],
  ["chunks", "DELETE", () => C_B.from("chunks").delete().eq("project_id", APP).select("id")],
  ["knowledge_items", "SELECT", () => C_B.from("knowledge_items").select("id").eq("project_id", APP)],
  ["knowledge_items", "INSERT", () => C_B.from("knowledge_items").insert({ project_id: APP, kind: "fact", statement: "evil", embedding: vec(10) }).select("id")],
  ["knowledge_items", "UPDATE", () => C_B.from("knowledge_items").update({ statement: "evil" }).eq("project_id", APP).select("id")],
  ["knowledge_items", "DELETE", () => C_B.from("knowledge_items").delete().eq("project_id", APP).select("id")],
  ["provenance_links", "SELECT", () => C_B.from("provenance_links").select("id").eq("project_id", APP)],
  ["provenance_links", "INSERT", () => C_B.from("provenance_links").insert({ project_id: APP, from_type: "chunk", from_id: "0".repeat(36).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"), to_type: "chunk", to_id: "0".repeat(36).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"), relation: "cites" }).select("id")],
  ["provenance_links", "UPDATE", () => C_B.from("provenance_links").update({ relation: "conflicts_with" }).eq("project_id", APP).select("id")],
  ["provenance_links", "DELETE", () => C_B.from("provenance_links").delete().eq("project_id", APP).select("id")],
  ["research_pages", "SELECT", () => C_B.from("research_pages").select("id").eq("project_id", APP)],
  ["research_pages", "INSERT", () => C_B.from("research_pages").insert({ project_id: APP, user_id: ub.id, url: `https://evil.example.com/${ts}` }).select("id")],
  ["research_pages", "UPDATE", () => C_B.from("research_pages").update({ title: "evil" }).eq("project_id", APP).select("id")],
  ["research_pages", "DELETE", () => C_B.from("research_pages").delete().eq("project_id", APP).select("id")],
  ["queries", "SELECT", () => C_B.from("queries").select("id").eq("project_id", APP)],
  ["queries", "INSERT", () => C_B.from("queries").insert({ project_id: APP, user_id: ub.id, client: "eval", question: "evil" }).select("id")],
  ["queries", "UPDATE", () => C_B.from("queries").update({ answer: "evil" }).eq("project_id", APP).select("id")],
  ["queries", "DELETE", () => C_B.from("queries").delete().eq("project_id", APP).select("id")],
  ["api_tokens", "SELECT", () => C_B.from("api_tokens").select("id").eq("user_id", ua.id)],
  ["api_tokens", "INSERT", () => C_B.from("api_tokens").insert({ user_id: ua.id, name: "steal", token_hash: sha(`steal${ts}`) }).select("id")],
  ["api_tokens", "UPDATE", () => C_B.from("api_tokens").update({ name: "evil" }).eq("user_id", ua.id).select("id")],
  ["api_tokens", "DELETE", () => C_B.from("api_tokens").delete().eq("user_id", ua.id).select("id")],
  ["jobs", "SELECT", () => C_B.from("jobs").select("id").eq("project_id", APP)],
  ["jobs", "INSERT", () => C_B.from("jobs").insert({ project_id: APP, kind: "snapshot" }).select("id")],
  ["jobs", "UPDATE", () => C_B.from("jobs").update({ status: "done" }).eq("project_id", APP).select("id")],
  ["jobs", "DELETE", () => C_B.from("jobs").delete().eq("project_id", APP).select("id")],
];

for (const [table, op, fn] of crossCases) {
  const { data, error } = await fn();
  if (op === "SELECT") {
    const rows = data?.length ?? 0;
    record(table, op, rows === 0, `rows=${rows}`);
  } else if (op === "INSERT") {
    const denied = !!error; // expected: RLS with-check fails
    record(table, op, denied, error?.message ?? "accepted?!");
  } else {
    const touched = data?.length ?? 0;
    record(table, op, touched === 0, `rows=${touched}`);
  }
}

// function boundary (security invoker): B calls match_chunks on A's project -> 0 rows
{
  const { data, error } = await C_B.rpc("match_chunks", { p_project: APP, p_embedding: vec(11), p_k: 5 });
  const rows = data?.length ?? 0;
  record("match_chunks", "SELECT", rows === 0, `rows=${rows}${error ? " err=" + error.message.slice(0, 60) : ""}`);
  const pos = await C_A.rpc("match_chunks", { p_project: APP, p_embedding: vec(7), p_k: 5 });
  record("match_chunks", "POS_A", (pos.data?.length ?? 0) >= 1, `rows=${pos.data?.length ?? 0}`);
}

// positive controls
{
  const a = await C_A.from("projects").select("id").eq("id", APP);
  record("positive", "A-own-select", a.data?.length === 1, `rows=${a.data?.length ?? 0}`);
  const b = await C_B.from("projects").select("id").eq("id", PBP);
  record("positive", "B-own-select", b.data?.length === 1, `rows=${b.data?.length ?? 0}`);
  const ab = await C_A.from("projects").select("id").eq("id", PBP);
  record("positive", "A-on-B", ab.data?.length === 0, `rows=${ab.data?.length ?? 0}`);
}

// cleanup
try { await admin.auth.admin.deleteUser(ua.id); } catch {}
try { await admin.auth.admin.deleteUser(ub.id); } catch {}

// ---------- report ----------
const fail = results.filter((r) => !r.ok);
console.log(`S1.5 isolation test — ${results.length - fail.length}/${results.length} PASS\n`);
const grid = {};
for (const r of results) (grid[r.table] ??= []).push(`${r.op}:${r.ok ? "PASS" : "FAIL"}`);
const line = "  " + "=" .repeat(66);
for (const [t, ops] of Object.entries(grid)) {
  console.log(line);
  console.log(`  ${t.padEnd(16)} ${ops.join("  ")}`);
}
for (const r of fail) console.log(`\n  FAIL ${r.table}.${r.op}: ${r.note}`);
console.log("\nResult:", fail.length === 0 ? "ALL ISOLATED ✅" : `${fail.length} CHECKS FAILED ❌`);
process.exit(fail.length === 0 ? 0 : 1);
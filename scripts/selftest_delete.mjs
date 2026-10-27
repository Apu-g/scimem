#!/usr/bin/env node
// Delete-paths E2E: chunk-level removal and project-level cascade, against a
// throwaway project so real memory is never at risk. Verifies the row counts
// before/after with the service role, because the whole point of the cascade is
// what happens to rows the API does not return.
// Usage: node scripts/selftest_delete.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.SCIMEM_WEB_URL ?? 'http://localhost:3000';
const env = Object.fromEntries(
  readFileSync('apps/web/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const {
  data: { session },
  error,
} = await supabase.auth.signInWithPassword({
  email: env.SCIMEM_DEMO_EMAIL,
  password: env.SCIMEM_DEMO_PASSWORD,
});
if (error) throw error;
const token = session.access_token;
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const PROJECT = `del-e2e-${Date.now()}`;
const counts = async (projectId) => {
  const [e, c, q] = await Promise.all([
    admin.from('events').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    admin.from('chunks').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    admin.from('queries').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
  ]);
  return { events: e.count ?? 0, chunks: c.count ?? 0, queries: q.count ?? 0 };
};

// ------------------------------------------------------------------ fixture
// capture-page is the endpoint that creates a project by name; plain /api/capture
// always writes into Default, which is why it cannot be used for a throwaway.
const html = `<html><body><article>
  <h1>Delete E2E fixture</h1>
  <p>${'Retrieval ranking blends vector similarity with lexical overlap and recency. '.repeat(30)}</p>
</article></body></html>`;
const cap = await fetch(`${BASE}/api/capture-page`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    url: `https://delete-e2e.example.com/${PROJECT}`,
    title: 'Delete E2E fixture',
    html,
    projectName: PROJECT,
  }),
});
const capJson = await cap.json();
check(
  'created a throwaway project with chunks',
  cap.ok && capJson.chunks > 0 && capJson.event_id,
  JSON.stringify(capJson).slice(0, 140),
);

const proj = await admin.from('projects').select('id').eq('name', PROJECT).single();
if (!proj.data) throw new Error(`fixture project "${PROJECT}" was not created: ${JSON.stringify(capJson)}`);
const projectId = proj.data.id;
const before = await counts(projectId);
console.log(`  rows before: ${JSON.stringify(before)}`);

// ------------------------------------------------------- auth is enforced
for (const call of [
  ['GET', `/api/chunks?eventId=${capJson.event_id}`],
  ['DELETE', `/api/chunks?id=x`],
  ['DELETE', `/api/projects?projectId=${projectId}`],
]) {
  const res = await fetch(`${BASE}${call[1]}`, { method: call[0] });
  check(`401 anon ${call[0]} ${call[1].split('?')[0]}`, res.status === 401, `got ${res.status}`);
}

// --------------------------------------------------------- chunk deletion
const chunksRes = await fetch(`${BASE}/api/chunks?eventId=${capJson.event_id}`, { headers: auth });
const { chunks } = await chunksRes.json();
check('GET /api/chunks lists the source chunks', chunksRes.ok && chunks.length > 0, `${chunks?.length} chunks`);

const victim = chunks[0];
const del = await fetch(`${BASE}/api/chunks?id=${victim.id}`, { method: 'DELETE', headers: auth });
const delJson = await del.json();
check('DELETE /api/chunks removes exactly one chunk', del.ok && delJson.ok === true, JSON.stringify(delJson));
const afterChunk = await counts(projectId);
check('chunk count dropped by one', afterChunk.chunks === before.chunks - 1, `${before.chunks} → ${afterChunk.chunks}`);
check('the source itself survived', afterChunk.events === before.events, `events ${afterChunk.events}`);

// deleting it twice is a no-op, not a crash
const again = await fetch(`${BASE}/api/chunks?id=${victim.id}`, { method: 'DELETE', headers: auth });
check('deleting the same chunk twice is harmless', again.ok, `got ${again.status}`);

// ------------------------------------------------------ project cascade
const delProj = await fetch(`${BASE}/api/projects?projectId=${projectId}`, {
  method: 'DELETE',
  headers: auth,
});
const projJson = await delProj.json();
check('DELETE /api/projects succeeds', delProj.ok && projJson.ok === true, JSON.stringify(projJson));
check(
  'response reports the cascaded counts',
  projJson.cascaded?.chunks === afterChunk.chunks,
  JSON.stringify(projJson.cascaded),
);

const gone = await admin.from('projects').select('id').eq('id', projectId).maybeSingle();
check('the project row is gone', !gone.data, gone.data ? 'still there' : '');
for (const table of ['events', 'chunks', 'queries']) {
  const { count } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  check(`${table} cascaded to zero`, count === 0, `count=${count}`);
}

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

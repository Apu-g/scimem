// Extension capture-pipeline E2E against the LOCAL dev server.
// Signs in as the demo user, then:
//   1. POST /api/capture-page (HTML + screenshot + projectName) → verifies
//      extraction, embedding, research_pages upsert, and snapshot uploads
//   2. re-capture same URL → duplicate + visit_count bump
//   3. GET /api/projects → new project present
//   4. POST /api/ask scoped to that project → cited answer
//   5. POST /api/ask against a never-used project → 404
// Usage: node scripts/selftest_extension_capture.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.SCIMEM_WEB_URL ?? 'http://localhost:3000';
const envFile = readFileSync('apps/web/.env.local', 'utf8');
const env = Object.fromEntries(
  envFile.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).trim()];
  }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

for (let i = 0; i < 20; i++) {
  try {
    const r = await fetch(`${BASE}/`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const supabase = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
const demoEmail = env.SCIMEM_DEMO_EMAIL;
const demoPassword = env.SCIMEM_DEMO_PASSWORD;
if (!demoEmail || !demoPassword) throw new Error('SCIMEM_DEMO_EMAIL / SCIMEM_DEMO_PASSWORD not set in apps/web/.env.local');
const { data, error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPassword });
if (error) throw new Error(`sign-in failed: ${error.message}`);
const token = data.session.access_token;
console.log(`signed in as ${demoEmail}`);

// Fresh project + URL per run → every run exercises the full embed path
// (project-wide dedupe on content_hash would otherwise short-circuit repeats),
// while the in-run re-capture still proves duplicate handling.
const PROJECT = `ext-e2e-${Date.now()}`;
const URL_UNDER_TEST = `https://example.com/scimem-retrieval-guide?run=${Date.now()}`;

// Realistic page: article content + chrome (nav/footer/script) that must be stripped.
const html = `<!doctype html>
<html><head><title>SCIMEM Retrieval Guide</title>
<meta name="description" content="how match_chunks works"/>
<script>window.hideMe = () => 'noise';</script></head>
<body>
<nav><a href="/">Home</a><a href="/docs">Docs</a><a href="/support">Support</a></nav>
<main>
  <h1>How SCIMEM Retrieval Works</h1>
  <p>The match_chunks function does vector similarity search over a project's
  chunks table. It pulls the top k chunks closest to the embedding of a user
  question, ordered by cosine similarity.</p>
  <p>Each row the function returns carries a hops count. That number is the
  length of the lineage path from the matched chunk back to the event and
  project it came from — it powers provenance and, later, graph backtracking.</p>
  <p>Chunks live in the chunks table with a vector(2048) embedding column.
  Because pgvector caps float32 index dimensions at 2000, the HNSW index is
  built over a halfvec(2048) cast of that embedding using cosine distance.</p>
  <p>Retrieval never leaves the tenant boundary: the function takes a
  project_id parameter and RLS policies keep every project's rows isolated.</p>
</main>
<footer>Copyright Example Inc. — ignore me, I am chrome.</footer>
</body></html>`;

// 1x1 PNG (public domain test pixel).
const screenshotB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// --- 1. first capture ---
const cap = await fetch(`${BASE}/api/capture-page`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: URL_UNDER_TEST, title: 'SCIMEM Retrieval Guide', html, screenshot: `data:image/png;base64,${screenshotB64}`, projectName: PROJECT }),
});
const capJson = await cap.json();
console.log(`CAPTURE ${cap.status}:`, JSON.stringify({ ok: capJson.ok, chunks: capJson.chunks, text_chars: capJson.text_chars, dup: capJson.duplicate, snapshot: capJson.snapshot_path, shot: capJson.screenshot_path, latency_ms: capJson.latency_ms }));

// --- 2. re-capture same URL + project (expect duplicate + visit bump) ---
const cap2 = await fetch(`${BASE}/api/capture-page`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: URL_UNDER_TEST, title: 'SCIMEM Retrieval Guide (second visit)', html, projectName: PROJECT }),
});
const cap2Json = await cap2.json();
console.log(`RE-CAPTURE ${cap2.status}: duplicate=${cap2Json.duplicate}`);

const { data: pageRow } = await supabase
  .from('research_pages')
  .select('id, url, visit_count, snapshot_path, user_id')
  .eq('url', URL_UNDER_TEST)
  .single();
console.log('research_pages row:', JSON.stringify({ visit_count: pageRow?.visit_count, snapshot_path_set: !!pageRow?.snapshot_path, own_row: !!pageRow?.user_id }));

const { data: evtRow } = await supabase
  .from('events')
  .select('id, source_type, platform, url, content_hash, metadata')
  .eq('url', URL_UNDER_TEST)
  .single();
console.log('events row:', JSON.stringify({ source_type: evtRow?.source_type, platform: evtRow?.platform, has_meta: !!evtRow?.metadata?.snapshot_path, capture: evtRow?.metadata?.capture }));

// --- verify snapshot object exists in storage (service role) ---
let snapshotExists = false;
if (capJson.snapshot_path) {
  const head = await fetch(`${URL}/storage/v1/object/info/snapshots/${capJson.snapshot_path}`, {
    headers: { Authorization: `Bearer ${SERVICE}` },
  });
  snapshotExists = head.ok;
  console.log(`snapshot object exists: ${snapshotExists} (${head.status})`);
}

// --- 3. projects list ---
const projects = await fetch(`${BASE}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
const projectsJson = await projects.json();
console.log('PROJECTS:', JSON.stringify((projectsJson.projects ?? []).map((p) => p.name)));

// --- 4. ask scoped to the project ---
const ask = await fetch(`${BASE}/api/ask`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'What does the "hops" field in match_chunks represent and why is it useful?', projectName: PROJECT }),
});
const askJson = await ask.json();
console.log(`ASK ${ask.status}:`);
console.log('  answer:', (askJson.answer ?? '').slice(0, 260));
console.log('  sources:', askJson.sources?.length ?? 0, '| model:', askJson.model, '| reranked:', askJson.reranked, '| latency:', askJson.latency_ms + 'ms');
if (askJson.error) console.log('  ERROR:', askJson.error);

// --- 5. ask against a never-used project → 404 ---
const ask404 = await fetch(`${BASE}/api/ask`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'anything?', projectName: 'definitely-not-a-project' }),
});
const ask404Json = await ask404.json();
console.log(`ASK-404 ${ask404.status}: ${ask404Json.error ?? ''}`);

const failures = [];
if (capJson.ok !== true) failures.push('capture not ok');
if ((capJson.chunks ?? 0) === 0) failures.push('no chunks embedded');
if ((capJson.text_chars ?? 0) < 300) failures.push('extraction too small (nav/footer not stripped?)');
if (!capJson.snapshot_path) failures.push('no html snapshot path');
if (!capJson.screenshot_path) failures.push('no screenshot path');
if (cap2Json.duplicate !== true) failures.push('re-capture not deduped');
if ((pageRow?.visit_count ?? 0) < 2) failures.push('visit_count not bumped');
if (!pageRow?.snapshot_path) failures.push('research_pages.snapshot_path not set');
if (!evtRow) failures.push('no events row');
if (!snapshotExists) failures.push('snapshot object missing in storage');
if (!projectsJson.projects?.some((p) => p.name === PROJECT)) failures.push('project not in /api/projects');
if (!askJson.answer) failures.push('ask returned no answer');
if ((askJson.sources ?? []).length === 0) failures.push('ask returned no sources');
if (ask404.status !== 404) failures.push('missing-project ask did not 404');

console.log('\nRESULT:', failures.length === 0 ? 'CAPTURE-PAGE E2E PASSED ✅' : `FAILED ❌ ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
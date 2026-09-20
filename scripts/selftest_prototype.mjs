// Prototype E2E smoke test against the LOCAL dev server.
// Signs in as the demo user, then hits /api/capture and /api/ask with a Bearer token.
// Usage: node scripts/selftest_prototype.mjs
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

// wait for the server
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

const content = [
  'Decision (locked 2026-09-21): SCIMEM uses nvidia/nemotron-3-embed-1b for embeddings, dimension 2048.',
  'Important: this model REQUIRES an input_type field — "query" when embedding a user question and "passage" when embedding stored content. Using the wrong label hurts retrieval.',
  'The hnsw index stores a halfvec(2048) cast of the embedding because pgvector caps float32 vector indexes at 2000 dimensions.',
  'Groq (openai/gpt-oss-20b) handles fast structured JSON; OpenRouter (anthropic/claude-sonnet-5) generates the cited answers.',
].join('\n\n');

const cap = await fetch(`${BASE}/api/capture`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ content, title: 'SCIMEM embed decision' }),
});
const capJson = await cap.json();
console.log(`CAPTURE ${cap.status}:`, JSON.stringify(capJson).slice(0, 220));

// duplicate check
const dup = await fetch(`${BASE}/api/capture`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ content }),
});
const dupJson = await dup.json();
console.log(`DUPLICATE ${dup.status}: duplicate=${dupJson.duplicate} (${dupJson.latency_ms}ms)`);

const ask = await fetch(`${BASE}/api/ask`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'What embedding model and dimension does SCIMEM use, and what input_type values does it need?' }),
});
const askJson = await ask.json();
console.log(`ASK ${ask.status}:`);
console.log('  answer:', (askJson.answer ?? '').slice(0, 400));
console.log('  sources:', askJson.sources?.length ?? 0, '| model:', askJson.model, '| reranked:', askJson.reranked, '| latency:', askJson.latency_ms + 'ms');
if (askJson.error) console.log('  ERROR:', askJson.error);

const failures = [];
if (capJson.ok !== true) failures.push('capture did not return ok');
if (dupJson.duplicate !== true) failures.push('dedupe did not fire');
if (!askJson.answer) failures.push('ask returned no answer');
if ((askJson.sources ?? []).length === 0) failures.push('ask returned no sources');
console.log('\nRESULT:', failures.length === 0 ? 'E2E SMOKE PASSED ✅' : `FAILED ❌ ${failures.join('; ')}`);
process.exit(failures.length === 0 ? 0 : 1);
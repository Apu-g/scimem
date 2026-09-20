// Wikipedia capture -> ask, end to end, mirroring the user's exact scenario.
// Run from repo root:  node scripts/selftest_wikipedia.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = fileURLToPath(new URL('.', import.meta.url));
const env = Object.fromEntries(
  readFileSync(`${here}../apps/web/.env.local`, 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }),
);
const BASE = process.env.SCIMEM_WEB_URL ?? 'http://localhost:3000';

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: signin, error: signinErr } = await supabase.auth.signInWithPassword({
  email: env.SCIMEM_DEMO_EMAIL,
  password: env.SCIMEM_DEMO_PASSWORD,
});
if (signinErr) throw new Error(`sign-in failed: ${signinErr.message}`);
const token = signin.session.access_token;

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
  return { status: res.status, body: await res.json() };
}

const project = `wiki-test-${Date.now()}`;
const wikiHtml = readFileSync('/tmp/opencode/wiki_rag.html', 'utf8');
const url = 'https://en.wikipedia.org/wiki/Retrieval-augmented_generation';

const cap = await api('/api/capture-page', {
  method: 'POST',
  body: JSON.stringify({
    url,
    title: 'Retrieval-augmented generation - Wikipedia',
    html: wikiHtml,
    projectName: project,
  }),
});
console.log('CAPTURE:', cap.status, JSON.stringify({
  project: cap.body.project,
  platform: cap.body.platform,
  chunks: cap.body.chunks,
  text_chars: cap.body.text_chars,
  note: cap.body.note,
}));

const ask = await api('/api/ask', {
  method: 'POST',
  body: JSON.stringify({ question: 'What is retrieval-augmented generation and how does it work?', projectName: project }),
});
console.log('ASK:', ask.status);
console.log('answer:', (ask.body.answer ?? ask.body.error ?? '').slice(0, 700));
console.log('sources:', (ask.body.sources ?? []).length, '| model:', ask.body.model, '| reranked:', ask.body.reranked);
// Real-DOM extraction test: Wikipedia HTML + stored Claude snapshot.
// Run from apps/web:  node ../scripts/test_extract_real.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { extractReadableText } from '../apps/web/lib/extract.ts';
import { splitChunks } from '../apps/web/lib/pipeline.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const env = Object.fromEntries(
  (await readFile(`${here}../apps/web/.env.local`, 'utf8')).split('\n').filter(Boolean)
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function summarize(label, text, chunks, checks) {
  const maxChunk = Math.max(...chunks.map((c) => c.length), 0);
  const totalChars = chunks.reduce((a, c) => a + c.length, 0);
  console.log(`\n=== ${label} ===`);
  console.log(`extracted chars: ${text.length}`);
  console.log(`chunks: ${chunks.length} | max chunk: ${maxChunk} chars | total ${totalChars}`);
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  }
  console.log('--- first 400 chars ---');
  console.log(text.slice(0, 400));
  console.log('--- tail 300 chars ---');
  console.log(text.slice(-300));
}

// 1) Wikipedia — real HTML fetched from the live site
const wikiHtml = await readFile('/tmp/opencode/wiki_rag.html', 'utf8');
const wikiUrl = 'https://en.wikipedia.org/wiki/Retrieval-augmented_generation';
const wikiText = extractReadableText(wikiHtml, wikiUrl);
const wikiChunks = splitChunks(wikiText);
summarize('WIKIPEDIA (pugpt-project capture)', wikiText, wikiChunks, {
  'has RAG definition': wikiText.includes('information retrieval') || wikiText.includes('neural networks'),
  'no "Jump to content" chrome': !wikiText.includes('Jump to content'),
  'no "24 languages" chrome': !wikiText.includes('24 languages'),
  'no "Edit links" chrome': !wikiText.includes('Edit links'),
  'no "Wiki Loves Monuments"': !wikiText.includes('Wiki Loves Monuments'),
  'no single giant chunk': Math.max(...wikiChunks.map((c) => c.length)) <= 1100,
  'multiple chunks': wikiChunks.length >= 3,
});

// 2) Claude — downloaded from storage via SDK
const claudePath = '12305f73-76f4-4f91-a54b-2d3cf5f2d0bf/3f9ce855-930c-4ab8-ac17-5e555027e681/02ea672b5d48eb72de22131ab36eb1fa69073235711c5c3c425c8c220e9c2058.html';
const { data: claudeSnap } = await supa.storage.from('snapshots').download(claudePath);
const claudeHtml = await claudeSnap.text();
const claudeUrl = 'https://claude.ai/chat/93ca25e2-8235-4bb9-badd-dd48578d13e4';
const claudeText = extractReadableText(claudeHtml, claudeUrl);
const claudeChunks = splitChunks(claudeText);
summarize('CLAUDE PU GPT convo', claudeText, claudeChunks, {
  'has real content (RBAC/RAG/H200)': /RBAC|RAG|H200|role-based|retrieval/i.test(claudeText),
  'no "Free plan"': !claudeText.includes('Free plan'),
  'no "Upgrade"': !claudeText.includes('Upgrade'),
  'no doubled instruction line': (claudeText.match(/\[Caveman mode is ON/g) ?? []).length <= 1,
  'no "Updated memory" notices': !/Updated memory/.test(claudeText),
  'chunks reasonably sized': Math.max(...claudeChunks.map((c) => c.length)) <= 1500,
});
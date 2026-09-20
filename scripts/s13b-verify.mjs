// S1.3b — verify provider facts with real calls.
// Reads API keys from keys.txt. Prints latency / dimension / ranking / token usage.
// NEVER prints the keys themselves.
import { readFileSync } from 'node:fs';

const keysRaw = readFileSync('keys.txt', 'utf8');
const keyOf = (label) => {
  const line = keysRaw.split('\n').find((l) => l.startsWith(`${label} `));
  if (!line) throw new Error(`missing key: ${label}`);
  return line.replace(/^[a-z]+\s+-?\s*/, '').split(' ')[0].trim();
};

const NVIDIA_KEY = keyOf('nvidia');
const GROQ_KEY = keyOf('groq');
const OPENROUTER_KEY = keyOf('openrouter');

const t0 = Date.now();
const json = async (url, init) => {
  const res = await fetch(url, init);
  const body = await res.json();
  return { status: res.status, body };
};
const note = (label, ms) => console.log(`${label.padEnd(46)} ${String(ms).padStart(7)}ms`);
const ms = () => Date.now() - t0;

const EMBED_MODELS = [
  'nvidia/nemotron-3-embed-1b',
  'nvidia/llama-nemotron-embed-1b-v2',
  'nvidia/nv-embed-v1',
];
const RERANK_MODEL = 'nvidia/nv-rerankqa-mistral-4b-v3';
const GROQ_MODEL = 'openai/gpt-oss-20b';
const OPENROUTER_MODEL = 'anthropic/claude-sonnet-5';

// ---------- 1. NVIDIA embedding (query + passage) ----------
let dim = null;
let EMBED_MODEL = null;
for (const candidate of EMBED_MODELS) {
  const start = Date.now();
  const { status, body } = await json('https://integrate.api.nvidia.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${NVIDIA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: candidate,
      input: [
        'What database should we use for the SCIMEM project?',
        'We decided to use PostgreSQL because we need pgvector for retrieval.',
      ],
      input_type: 'query',
      modality: 'text',
      encoding_format: 'float',
    }),
  });
  const first = body?.data?.[0]?.embedding;
  if (status === 200 && first) {
    note(`${candidate} embed (status ${status})`, Date.now() - start);
    dim = first.length;
    EMBED_MODEL = candidate;
    console.log(`  embedding dimension = ${dim}   total_tokens = ${body?.usage?.total_tokens}`);
    break;
  }
  console.log(`  ${candidate} embed FAILED (${status}): ${JSON.stringify(body).slice(0, 200)}`);
}
if (!EMBED_MODEL) process.exit(1);

// ---------- 2. NVIDIA rerank ----------
{
  const start = Date.now();
  const passages = [
    'The frontend is built with React and Tailwind.',
    'We chose PostgreSQL with pgvector for the SCIMEM database.',
    'Deployment happens on Vercel with cron jobs enabled.',
    'The extension is written in vanilla JavaScript.',
    'MongoDB was considered but rejected in the design review.',
  ];
  const { status, body } = await json(
    'https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${NVIDIA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query: { text: 'Which database does SCIMEM use?' },
        passages: passages.map((text) => ({ text })),
      }),
    },
  );
  note(`${RERANK_MODEL} rerank (status ${status})`, Date.now() - start);
  if (status !== 200) {
    console.log('  rerank FAILED:', JSON.stringify(body).slice(0, 300));
  } else {
    const order = body.rankings
      .map((r) => `${r.index}(${r.logit.toFixed(3)})`)
      .join(' ');
    console.log(`  rankings[passage->score]: ${order}`);
    const top = body.rankings[0]?.index;
    console.log(`  top passage #${top}: "${passages[top].slice(0, 60)}..."`);
  }
}

// ---------- 3. Groq fast chat (JSON mode) ----------
{
  const start = Date.now();
  const { status, body } = await json('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Respond only with JSON: {"ok": boolean, "db": "postgres|mongo"}' },
        { role: 'user', content: 'The team picked Postgres for the database. What database is it?' },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 120,
    }),
  });
  note(`${GROQ_MODEL} chatFast (status ${status})`, Date.now() - start);
  const content = body?.choices?.[0]?.message?.content;
  console.log(`  content: ${String(content).slice(0, 120)}`);
  const usage = body?.usage;
  if (usage) console.log(`  tokens: in=${usage.prompt_tokens} out=${usage.completion_tokens}`);
}

// ---------- 4. OpenRouter answer chat ----------
{
  const start = Date.now();
  const { status, body } = await json('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'SCIMEM-s13b-verify',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'user', content: 'Reply with exactly: provenance matters' },
      ],
      max_tokens: 60,
    }),
  });
  note(`${OPENROUTER_MODEL} chatAnswer (status ${status})`, Date.now() - start);
  const content = body?.choices?.[0]?.message?.content;
  console.log(`  content: ${String(content).slice(0, 120)}`);
  console.log(`  routed model: ${body?.model ?? 'n/a'}`);
}

console.log(`TOTAL: ${ms()}ms across ${EMBED_MODEL} + ${RERANK_MODEL} + ${GROQ_MODEL} + ${OPENROUTER_MODEL}`);
console.log(`FINAL: NVIDIA_EMBED_DIM=${dim}`);
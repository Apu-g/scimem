// Quick test for the enhanced extraction logic
// Tests both Claude chat page and normal article extraction

const cheerio = require('cheerio');

// Mock the extraction functions (copy from lib/extract.ts for testing)
function normalizeText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ');
}

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'svg', 'head', 'iframe', 'form', 'button',
  'nav', 'footer', 'aside', 'canvas', 'video', 'audio', 'link', 'meta', 'dialog',
];

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname;
    if (/claude\.ai/i.test(host)) return 'claude';
    if (/chatgpt\.com|chat\.openai\.com/i.test(host)) return 'chatgpt';
    if (/gemini\.google\.com/i.test(host)) return 'gemini';
    if (/perplexity\.ai/i.test(host)) return 'perplexity';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function stripChatNoise(text) {
  const noisePatterns = [
    /Free plan/gi,
    /Upgrade/gi,
    /Claude finished the response/gi,
    /Use the up and down arrow keys to move between messages/gi,
    /ChatGPT can make mistakes\. Check important info\./gi,
    /Stop generating/gi,
    /Regenerate response/gi,
    /Copy message/gi,
    /Edit message/gi,
    /Share/gi,
    /New chat/gi,
    /Clear chat/gi,
    /\d+ messages? in this conversation/gi,
    /View all/gi,
    /Sign out/gi,
    /Settings/gi,
    /Help & FAQ/gi,
    /Keyboard shortcuts/gi,
    /What can I help with\?/gi,
    /Send a message/gi,
    /Message Claude/gi,
  ];

  let cleaned = text;
  for (const pat of noisePatterns) {
    cleaned = cleaned.replace(pat, '');
  }
  return cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function extractClaudeContent($) {
  const messages = [];
  const articleEls = $('[role="article"]');
  if (articleEls.length > 0) {
    articleEls.each((_, el) => {
      const text = normalizeText($(el).text());
      if (text.length > 20) {
        messages.push(text);
      }
    });
  }
  return messages.length > 0 ? messages.join('\n\n---\n\n') : '';
}

function extractGenericContent($) {
  let best = '';
  for (const sel of ['main', 'article', '[role="main"]', '[role="article"]', 'body']) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const text = normalizeText(el.text());
    if (text.length > best.length) best = text;
  }
  return best;
}

function extractReadableText(html, url) {
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS.join(',')).remove();
  const platform = url ? detectPlatform(url) : 'unknown';
  let text = '';
  if (platform === 'claude') {
    text = extractClaudeContent($);
  } else {
    text = extractGenericContent($);
  }
  if (text.length < 50) {
    text = extractGenericContent($);
  }
  text = stripChatNoise(text);
  return text.slice(0, 200_000);
}

// TEST 1: Claude chat page with role="article" elements
const claudeHtml = `
<!DOCTYPE html>
<html>
<head><title>PU GPT - Claude</title></head>
<body>
<nav>Navigation stuff</nav>
<footer>Footer stuff</footer>
<div>
  <div role="article">
    <div>You said: I want to build a college chatbot with role-based access control and document retrieval. Can you help me design the architecture?</div>
  </div>
  <div role="article">
    <div>Claude: I'll help you design a comprehensive architecture for a college chatbot. Here's a detailed plan:

**1. Authentication & Role Management**
- JWT-based authentication with role-based access control (RBAC)
- Three main roles: Student, Faculty, Admin
- Each role has different permissions for accessing documents and features

**2. Document Retrieval System**
- Vector embeddings using NVIDIA nemotron-3-embed-1b (2048 dimensions)
- Store documents in Supabase with pgvector for similarity search
- Chunk documents into 900-character segments for better retrieval
- Implement hybrid search combining vector similarity and full-text search

**3. Chat Interface**
- Real-time WebSocket connections for streaming responses
- Context window management to maintain conversation history
- Source citation linking responses back to source documents

**4. Database Schema**
- users table with role field
- documents table with embeddings
- conversations and messages tables
- Access control policies per role

This architecture scales well and provides the flexibility you need for a college environment.</div>
  </div>
</div>
<div>Free plan</div>
<div>Upgrade</div>
<div>Use the up and down arrow keys to move between messages</div>
</body>
</html>
`;

// TEST 2: Normal article page
const articleHtml = `
<!DOCTYPE html>
<html>
<head><title>SCIMEM Embed Decision</title></head>
<body>
<nav>Home | About | Contact</nav>
<footer>Copyright 2026</footer>
<main>
  <h1>SCIMEM Embed Decision</h1>
  <p>Decision (locked 2026-09-21): SCIMEM uses nvidia/nemotron-3-embed-1b for embeddings, dimension 2048.</p>
  <p>Important: this model REQUIRES an input_type field — "query" when embedding a user question and "passage" when embedding stored content. Using the wrong label hurts retrieval.</p>
  <p>The hnsw index stores a halfvec(2048) cast of the embedding because pgvector caps float32 vector indexes at 2000 dimensions.</p>
</main>
</body>
</html>
`;

console.log('=== TEST 1: Claude Chat Page ===');
const claudeResult = extractReadableText(claudeHtml, 'https://claude.ai/chat/93ca25e2-8235-4bb9-badd-dd48578d13e4');
console.log('Platform detected:', detectPlatform('https://claude.ai/chat/93ca25e2-8235-4bb9-badd-dd48578d13e4'));
console.log('Length:', claudeResult.length, 'chars');
console.log('Preview:', claudeResult.slice(0, 500));
console.log('\nContains "role-based access":', claudeResult.includes('role-based access'));
console.log('Contains "nvidia":', claudeResult.includes('nvidia'));
console.log('Contains "Free plan":', claudeResult.includes('Free plan'));
console.log('Contains "Upgrade":', claudeResult.includes('Upgrade'));

console.log('\n=== TEST 2: Normal Article ===');
const articleResult = extractReadableText(articleHtml, 'https://example.com/scimem-decision');
console.log('Platform detected:', detectPlatform('https://example.com/scimem-decision'));
console.log('Length:', articleResult.length, 'chars');
console.log('Preview:', articleResult.slice(0, 500));
console.log('\nContains "SCIMEM uses nvidia":', articleResult.includes('SCIMEM uses nvidia'));
console.log('Contains "Home | About":', articleResult.includes('Home | About'));
console.log('Contains "Copyright 2026":', articleResult.includes('Copyright 2026'));

// Verify Claude extraction got the actual content
const hasClaudeContent = claudeResult.includes('JWT-based authentication') && claudeResult.includes('Vector embeddings');
console.log('\n=== SUMMARY ===');
console.log('Claude extraction got actual content:', hasClaudeContent ? '✅ PASS' : '❌ FAIL');
console.log('Article extraction worked:', articleResult.includes('SCIMEM uses nvidia') ? '✅ PASS' : '❌ FAIL');
console.log('UI noise stripped:', !claudeResult.includes('Free plan') && !claudeResult.includes('Upgrade') ? '✅ PASS' : '❌ FAIL');

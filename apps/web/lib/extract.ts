import * as cheerio from 'cheerio';

/** Collapse a DOM text dump into clean, paragraph-separated lines. */
export function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ');
}

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'svg', 'head', 'iframe', 'form', 'button',
  'nav', 'footer', 'aside', 'canvas', 'video', 'audio', 'link', 'meta', 'dialog',
];

/**
 * Extract the readable body text from raw page HTML.
 * Heuristic for the prototype: drop chrome elements, then take the largest text
 * block among <main>, <article>, [role=main], <body>. Upgrade to a readability
 * engine (Mozilla/Readability) at S9 when fidelity matters more.
 */
export function extractReadableText(html: string): string {
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS.join(',')).remove();

  let best = '';
  for (const sel of ['main', 'article', '[role="main"]', 'body']) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const text = normalizeText(el.text());
    if (text.length > best.length) best = text;
  }
  return best.slice(0, 200_000);
}
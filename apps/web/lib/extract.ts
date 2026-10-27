import * as cheerio from 'cheerio';

/**
 * Normalize a DOM text dump into clean text WITHOUT destroying paragraph
 * breaks. Blank lines in the source are preserved as '\n\n' so downstream
 * chunking can split at paragraph boundaries.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .reduce<string[]>((acc, line) => {
      if (!line) {
        // A blank line separates paragraphs — emit a single marker line.
        if (acc.length && acc[acc.length - 1] !== '') acc.push('');
        return acc;
      }
      acc.push(line.replace(/[ \t]{2,}/g, ' '));
      return acc;
    }, [])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n'); // collapse runs of blank lines
}

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'svg', 'head', 'iframe', 'form', 'button',
  'nav', 'footer', 'aside', 'canvas', 'video', 'audio', 'link', 'meta', 'dialog',
  '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
  '.breadcrumb', '.sidebar', '.cookie-banner', '.modal', '.popup',
];

/** Site/domain → extraction strategy platform. */
export function detectPlatform(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (/claude\.ai/i.test(host)) return 'claude';
    if (/chatgpt\.com|chat\.openai\.com/i.test(host)) return 'chatgpt';
    if (/gemini\.google\.com/i.test(host)) return 'gemini';
    if (/perplexity\.ai/i.test(host)) return 'perplexity';
    if (/wikipedia\.org/i.test(host)) return 'wikipedia';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Drop lines that are literally duplicated back-to-back (DOM mirrors). */
function collapseConsecutiveRepeats(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev === line) continue; // exact consecutive duplicate
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Clean Claude DOM artifacts inside a single message:
 * - "Updated memorypu-gpt.mdUpdated memory" is a doubled memory notice.
 * - User messages get mirrored back-to-back in the DOM ("[A][A]rest" and
 *   'You said: [A][A]rest'). Collapse any exact adjacent 24+ char copy.
 */
function cleanClaudeMessage(text: string): string {
  let cleaned = text;
  // Doubled memory notice (concatenated mid-line, e.g. after "Possible.")
  cleaned = cleaned.replace(/Updated memory[A-Za-z0-9_\-/.]*Updated memory/g, '');
  // Mirror collapse — only on lines that look like user-message echoes.
  const lines = cleaned.split('\n').map((line) => {
    if (/^(You said:|\[)/.test(line)) {
      return line.replace(/(.{24,200}?)\1/g, '$1');
    }
    return line;
  });
  cleaned = lines.join('\n');
  return collapseConsecutiveRepeats(cleaned).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strip common chat UI noise patterns from extracted text.
 * These appear across Claude, ChatGPT, Gemini, etc.
 */
function stripChatNoise(text: string): string {
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
  // Collapse multiple newlines/spaces
  return cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Platform-specific extraction for Claude.ai.
 * Targets role="article" message containers, skipping UI chrome.
 */
function extractClaudeContent($: cheerio.CheerioAPI): string {
  const messages: string[] = [];

  const articleEls = $('[role="article"]');
  if (articleEls.length > 0) {
    articleEls.each((_, el) => {
      const text = cleanClaudeMessage(normalizeText($(el).text()));
      if (text.length > 20) {
        messages.push(text);
      }
    });
  }

  if (messages.length > 0) {
    return messages.join('\n\n---\n\n');
  }

  // Fallback: look for message-like containers
  const chatContainers = $('[data-is-streaming], [class*="message"], [class*="turn"]');
  if (chatContainers.length > 0) {
    chatContainers.each((_, el) => {
      const text = normalizeText($(el).text());
      if (text.length > 20) {
        messages.push(text);
      }
    });
  }

  return messages.length > 0 ? messages.join('\n\n---\n\n') : '';
}

/**
 * Platform-specific extraction for ChatGPT.
 * Targets message containers with role attributes or markdown content.
 */
function extractChatGPTContent($: cheerio.CheerioAPI): string {
  const messages: string[] = [];

  const msgEls = $('[data-message-author-role]');
  if (msgEls.length > 0) {
    msgEls.each((_, el) => {
      const role = $(el).attr('data-message-author-role') ?? 'unknown';
      const text = normalizeText($(el).text());
      if (text.length > 20) {
        messages.push(`[${role}]: ${text}`);
      }
    });
  }

  if (messages.length > 0) {
    return messages.join('\n\n');
  }

  const markdownDivs = $('.markdown');
  if (markdownDivs.length > 0) {
    markdownDivs.each((_, el) => {
      const text = normalizeText($(el).text());
      if (text.length > 20) {
        messages.push(text);
      }
    });
  }

  return messages.length > 0 ? messages.join('\n\n---\n\n') : '';
}

/**
 * Platform-specific extraction for Gemini.
 */
function extractGeminiContent($: cheerio.CheerioAPI): string {
  const messages: string[] = [];

  const msgEls = $('[class*="conversation-container"] [class*="message"], [class*="model-response"], [class*="user-query"]');
  if (msgEls.length > 0) {
    msgEls.each((_, el) => {
      const text = normalizeText($(el).text());
      if (text.length > 20) {
        messages.push(text);
      }
    });
  }

  return messages.length > 0 ? messages.join('\n\n---\n\n') : '';
}

/**
 * Wikipedia / MediaWiki extraction: target the article body container
 * (#mw-content-text) instead of the whole page, and drop editing/ref chrome.
 */
function extractWikipediaContent($: cheerio.CheerioAPI): string {
  const wikiNoise = '.mw-editsection, .reference, .mw-references-wrap, .navbox, ' +
    '.hatnote, .mw-jump-link, .noprint, .catlinks, .printfooter, .mw-empty-elt, ' +
    '.ambox, .box-*, .mw-hidden-catlinks, .printfooter';
  $(wikiNoise).remove();

  const el = $('#mw-content-text').first().length
    ? $('#mw-content-text').first()
    : $('.mw-parser-output').first().length
      ? $('.mw-parser-output').first()
      : null;
  if (el) return normalizeText(el.text());

  return extractGenericContent($);
}

/**
 * Generic fallback: pick the first content container that holds real text
 * (priority order), falling back to the largest blob only when none qualify.
 * Picking the LONGEST always loses to <body>, which drags in chrome.
 */
function extractGenericContent($: cheerio.CheerioAPI): string {
  const candidates = [
    [ 'article', 200 ],
    [ '[role="main"]', 200 ],
    [ 'main', 200 ],
    [ '[role="article"]', 200 ],
    [ 'body', 200 ],
  ] as const;

  let fallback = '';
  for (const [sel, minLen] of candidates) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const text = normalizeText(el.text());
    if (text.length > fallback.length) fallback = text;
    if (text.length >= minLen) return text;
  }
  return fallback;
}

/**
 * Extract readable text from raw page HTML.
 * Detects the platform and uses appropriate extraction strategy:
 * - Chat platforms (Claude, ChatGPT, Gemini): actual conversation content
 * - Wikipedia: the #mw-content-text article body
 * - Normal pages: heuristic (strip chrome, first real content container)
 */
export function extractReadableText(html: string, url?: string): string {
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS.join(',')).remove();

  const platform = url ? detectPlatform(url) : 'unknown';

  let text = '';

  switch (platform) {
    case 'claude':
      text = extractClaudeContent($);
      break;
    case 'chatgpt':
      text = extractChatGPTContent($);
      break;
    case 'gemini':
      text = extractGeminiContent($);
      break;
    case 'wikipedia':
      text = extractWikipediaContent($);
      break;
    default:
      text = extractGenericContent($);
      break;
  }

  // If platform-specific extraction returned nothing meaningful, fall back to generic
  if (text.length < 50) {
    text = extractGenericContent($);
  }

  // Strip chat UI noise from any platform
  text = stripChatNoise(text);

  return text.slice(0, 200_000);
}
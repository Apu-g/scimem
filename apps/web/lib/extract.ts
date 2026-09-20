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
 * Detect the platform from the URL.
 * Returns 'claude' | 'chatgpt' | 'gemini' | 'unknown'.
 */
export function detectPlatform(url: string): string {
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

  // Claude uses role="article" for each message in the conversation
  const articleEls = $('[role="article"]');
  if (articleEls.length > 0) {
    articleEls.each((_, el) => {
      const text = normalizeText($(el).text());
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

  // ChatGPT uses [data-message-author-role] for message containers
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

  // Fallback: markdown content divs
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

  // Gemini uses conversation-container or message-specific classes
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
 * Generic fallback: pick the largest text block among common content containers.
 */
function extractGenericContent($: cheerio.CheerioAPI): string {
  let best = '';
  for (const sel of ['main', 'article', '[role="main"]', '[role="article"]', 'body']) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const text = normalizeText(el.text());
    if (text.length > best.length) best = text;
  }
  return best;
}

/**
 * Extract readable text from raw page HTML.
 * Detects the platform and uses appropriate extraction strategy:
 * - Chat platforms (Claude, ChatGPT, Gemini): extract actual conversation content
 * - Normal pages: heuristic (strip chrome, pick largest text block)
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

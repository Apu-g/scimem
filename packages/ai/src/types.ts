/** Shared AI-gateway types. */
import type { ServerEnv } from '@scimem/core';

/** One OpenAI-style completion message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Result of any chat call (Groq or OpenRouter). */
export interface ChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
}

/** Result of an embedding call. */
export interface EmbedResult {
  vectors: number[][];
  dim: number;
  tokensUsed: number;
  latencyMs: number;
  model: string;
}

/** Result of a rerank call. */
export interface RerankResult {
  /** Passage indices ordered best-first. */
  ranked: number[];
  /** Relevance logits aligned to `ranked`. */
  scores: number[];
  latencyMs: number;
  model: string;
}

/** Minimal OpenAI-compatible chat body — the one shape both Groq and OpenRouter accept. */
export interface ChatCompletionBody {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: Record<string, unknown> };
}

/** Shared fetch helper for OpenAI-compatible chat endpoints. */
export async function chatCompletion(
  url: string,
  env: ServerEnv,
  apiKey: string,
  body: ChatCompletionBody,
  extraHeaders: Record<string, string> = {},
): Promise<ChatResult> {
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`chat ${res.status} (${body.model}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices: { message: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const content = json.choices[0]?.message?.content;
  if (content === undefined || content === null) {
    throw new Error(`chat ${body.model}: empty choice content`);
  }
  return {
    content,
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - start,
    model: json.model ?? body.model,
  };
}
/**
 * Chat clients.
 *
 * - chatFast:  Groq, verified S1.3b (openai/gpt-oss-20b, ~700ms, JSON mode).
 * - chatAnswer: OpenRouter, verified S1.3b (anthropic/claude-sonnet-5, 2.7s).
 *
 * Both speak the OpenAI-compatible chat shape shared in ./types.
 */
import { serverEnv } from '@scimem/core';
import { chatCompletion, type ChatMessage, type ChatResult } from './types.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatFastRequest {
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

/** Cheap + fast; used for structured JSON work (task inference, extraction). */
export async function chatFast(request: ChatFastRequest): Promise<ChatResult> {
  const env = serverEnv();
  return chatCompletion(
    GROQ_URL,
    env,
    env.GROQ_API_KEY,
    {
      model: env.GROQ_MODEL,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.2,
      ...(request.json ? { response_format: { type: 'json_object' } } : {}),
    },
  );
}

export interface ChatAnswerRequest {
  messages: ChatMessage[];
  maxTokens?: number;
}

/** Higher-quality; used for final answer generation. */
export async function chatAnswer(request: ChatAnswerRequest): Promise<ChatResult> {
  const env = serverEnv();
  return chatCompletion(
    OPENROUTER_URL,
    env,
    env.OPENROUTER_API_KEY,
    {
      model: env.OPENROUTER_MODEL,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 1500,
      temperature: 0.3,
    },
    { 'X-Title': 'SCIMEM' },
  );
}
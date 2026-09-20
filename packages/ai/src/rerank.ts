/**
 * NVIDIA rerank client — an OPTIONAL quality step.
 *
 * S1.3b verified the endpoint and request shape
 * (`POST https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking`, body
 * `{ model, query: {text}, passages: [{text}] }`) but the account is NOT
 * provisioned for rerank functions yet (404 "Function not found for account").
 * So every failure surfaces as RerankUnavailableError and callers must fall
 * back to the pre-rerank order — never crash the retrieval pipeline.
 */
import { serverEnv } from '@scimem/core';
import type { RerankResult } from './types.js';

export class RerankUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RerankUnavailableError';
  }
}

export interface RerankRequest {
  query: string;
  passages: string[];
  topN?: number;
}

export async function rerank(request: RerankRequest): Promise<RerankResult> {
  const env = serverEnv();
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch('https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.NVIDIA_RERANK_MODEL,
        query: { text: request.query },
        passages: request.passages.map((text) => ({ text })),
      }),
    });
  } catch (e) {
    throw new RerankUnavailableError(`rerank network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new RerankUnavailableError(`rerank ${res.status} (${env.NVIDIA_RERANK_MODEL}): ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { rankings?: { index: number; logit: number }[] };
  if (!body.rankings) {
    throw new RerankUnavailableError('rerank: response missing rankings');
  }
  const subset = request.topN && request.topN > 0 ? body.rankings.slice(0, request.topN) : body.rankings;
  return {
    ranked: subset.map((r) => r.index),
    scores: subset.map((r) => r.logit),
    latencyMs: Date.now() - start,
    model: env.NVIDIA_RERANK_MODEL,
  };
}

/**
 * Reorder an array of results best-first using rerank, wrapped so callers can
 * do it in one line: `const ordered = (await safeRerank(try)) ?? original`.
 */
export async function safeRerank<T extends { content: string }>(
  query: string,
  items: T[],
): Promise<T[] | null> {
  try {
    const { ranked } = await rerank({ query, passages: items.map((i) => i.content) });
    return ranked
      .map((idx) => items[idx])
      .filter((x): x is T => x !== undefined);
  } catch (e) {
    if (e instanceof RerankUnavailableError) return null;
    throw e;
  }
}
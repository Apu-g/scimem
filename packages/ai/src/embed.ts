/**
 * NVIDIA embedding client (OpenAI-compatible endpoint).
 *
 * Verified in S1.3b: `nvidia/nemotron-3-embed-1b`, dimension 2048, on
 * `POST https://integrate.api.nvidia.com/v1/embeddings`. The `input_type`
 * field is REQUIRED by the model: `query` for user questions, `passage` for
 * stored content. Using the wrong label measurably hurts retrieval.
 */
import { serverEnv } from '@scimem/core';
import type { EmbedResult } from './types.js';

export type EmbedInputType = 'query' | 'passage';

export interface EmbedRequest {
  texts: string[];
  inputType: EmbedInputType;
}

export async function embed(request: EmbedRequest): Promise<EmbedResult> {
  const env = serverEnv();
  if (request.texts.length === 0) throw new Error('embed: no texts given');
  const start = Date.now();
  const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.NVIDIA_EMBED_MODEL,
      input: request.texts,
      input_type: request.inputType,
      modality: 'text',
      encoding_format: 'float',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`embed ${res.status} (${env.NVIDIA_EMBED_MODEL}): ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    data: { embedding: number[] }[];
    usage?: { total_tokens?: number };
  };
  const vectors = body.data.map((d) => d.embedding);
  for (const [i, v] of vectors.entries()) {
    if (v.length !== env.NVIDIA_EMBED_DIM) {
      throw new Error(
        `embed dim mismatch on text #${i}: expected ${env.NVIDIA_EMBED_DIM}, got ${v.length}`,
      );
    }
  }
  return {
    vectors,
    dim: env.NVIDIA_EMBED_DIM,
    tokensUsed: body.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
    model: env.NVIDIA_EMBED_MODEL,
  };
}

/** Render a 2048-dim float array as the pgvector text literal PostgREST casts cleanly. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
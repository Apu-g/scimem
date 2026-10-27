import { describe, expect, it } from 'vitest';
import {
  astarExpand,
  bm25Scores,
  hybridScore,
  mmrSelect,
  phraseBonus,
  rankCandidates,
  recencyWeight,
  tokenize,
  type Rankable,
} from './rank';

const chunk = (id: string, content: string, over: Partial<Rankable> = {}): Rankable => ({
  id,
  event_id: over.event_id ?? 'e1',
  content,
  similarity: over.similarity ?? 0.5,
  created_at: over.created_at ?? '2026-09-01T00:00:00.000Z',
});

describe('tokenize', () => {
  it('lowercases, splits on punctuation and drops stopwords', () => {
    expect(tokenize('What is the Nemotron-3-Embed-1B model?')).toEqual(['nemotron', 'embed', '1b', 'model']);
  });

  it('drops single characters as noise', () => {
    expect(tokenize('a b cd')).toEqual(['cd']);
  });
});

describe('bm25Scores', () => {
  it('ranks the chunk containing the query term highest', () => {
    const docs = [
      'completely unrelated text about gardening',
      'the nemotron embed model is used here',
      'another gardening note',
    ];
    const [a, b, c] = bm25Scores('nemotron embed', docs) as number[];
    expect(b).toBeGreaterThan(a!);
    expect(b).toBeGreaterThan(c!);
  });

  it('gives a term present in every document a near-zero idf', () => {
    const docs = ['context everywhere', 'context here too', 'context again'];
    const scores = bm25Scores('context', docs) as number[];
    expect(Math.max(...scores)).toBeLessThan(1.5);
  });

  it('does not crash on empty documents', () => {
    expect(() => bm25Scores('q', ['', 'x', ''])).not.toThrow();
  });
});

describe('recencyWeight', () => {
  const now = Date.parse('2026-10-01T00:00:00.000Z');

  it('halves at the half-life and decays further after', () => {
    const thirty = recencyWeight('2026-09-01T00:00:00.000Z', now, 30);
    const sixty = recencyWeight('2026-08-02T00:00:00.000Z', now, 30);
    expect(thirty).toBeCloseTo(0.5, 2);
    expect(sixty!).toBeLessThan(thirty!);
  });

  it('is neutral for a missing or unparseable timestamp', () => {
    expect(recencyWeight(null, now)).toBe(0.5);
    expect(recencyWeight('not-a-date', now)).toBe(0.5);
  });
});

describe('phraseBonus', () => {
  it('rewards a verbatim match and ignores very short queries', () => {
    expect(phraseBonus('scimem context', 'the SCIMEM Context file')).toBe(1);
    expect(phraseBonus('scimem context', 'nothing similar')).toBe(0);
    expect(phraseBonus('ab', 'ab cd')).toBe(0);
  });
});

describe('hybridScore', () => {
  it('lets an exact phrase outrank a marginally better vector score', () => {
    const loose = hybridScore({ vector: 0.62, bm25: 0.5, recency: 0.5, phrase: 0 });
    const exact = hybridScore({ vector: 0.55, bm25: 3, recency: 0.5, phrase: 1 });
    expect(exact).toBeGreaterThan(loose);
  });

  it('treats a missing vector similarity as zero rather than NaN', () => {
    const s = hybridScore({ vector: null, bm25: 1, recency: 0.5, phrase: 0 });
    expect(Number.isFinite(s)).toBe(true);
  });
});

describe('mmrSelect', () => {
  it('drops near-duplicates in favour of covering distinct material', () => {
    const ranked = [
      { item: chunk('a', 'pgvector stores embeddings and supports similarity search'), score: 1 },
      { item: chunk('b', 'pgvector stores embeddings and supports similarity search'), score: 0.99 },
      { item: chunk('c', 'the router blocks traffic to unknown hosts'), score: 0.7 },
    ];
    const picked = mmrSelect(ranked, 2).map((c) => c.id);
    expect(picked[0]).toBe('a');
    expect(picked).toContain('c');
    expect(picked).not.toContain('b');
  });

  it('returns everything when k exceeds the pool, and nothing when k is 0', () => {
    const ranked = [
      { item: chunk('a', 'alpha'), score: 1 },
      { item: chunk('b', 'beta'), score: 0.5 },
    ];
    expect(mmrSelect(ranked, 10)).toHaveLength(2);
    expect(mmrSelect(ranked, 0)).toHaveLength(0);
  });

  it('handles an empty pool', () => {
    expect(mmrSelect([], 5)).toEqual([]);
  });
});

describe('astarExpand', () => {
  const seeds = [chunk('a', 'seed content about vectors', { similarity: 0.9 })];
  const all = [
    ...seeds,
    chunk('b', 'sibling qualifier for the seed', { similarity: 0.8 }),
    chunk('c', 'far away sibling', { similarity: 0.2 }),
  ];
  const neighbours = (n: Rankable) => all.filter((x) => x.event_id === n.event_id && x.id !== n.id);

  it('pulls in close siblings but never ones below the ratio floor', () => {
    const added = astarExpand(seeds, all, { neighbours, ratio: 0.75, budget: 3 });
    expect(added.map((n) => n.id)).toContain('b');
    expect(added.map((n) => n.id)).not.toContain('c');
  });

  it('respects the budget', () => {
    const many = [
      ...seeds,
      chunk('d', 'sibling two', { similarity: 0.85 }),
      chunk('e', 'sibling three', { similarity: 0.83 }),
      chunk('f', 'sibling four', { similarity: 0.81 }),
    ];
    const added = astarExpand(seeds, many, {
      neighbours: (n) => many.filter((x) => x.event_id === n.event_id && x.id !== n.id),
      budget: 2,
    });
    expect(added.length).toBeLessThanOrEqual(2);
  });

  it('returns nothing with no seeds or no budget', () => {
    expect(astarExpand([], all, { neighbours })).toEqual([]);
    expect(astarExpand(seeds, all, { neighbours, budget: 0 })).toEqual([]);
  });

  it('never returns a seed twice', () => {
    const added = astarExpand(seeds, all, { neighbours, budget: 5 });
    expect(added.map((n) => n.id)).not.toContain('a');
  });
});

describe('rankCandidates', () => {
  const docs = [
    chunk('exact', 'the project uses nemotron-3-embed-1b with 2048 dimensions', { similarity: 0.5 }),
    chunk('dupe', 'the project uses nemotron-3-embed-1b with 2048 dimensions', { similarity: 0.49 }),
    chunk('other', 'dns configuration lives in the router, not the app', { similarity: 0.55 }),
    chunk('sib', 'the dimension must match the hnsw index', {
      event_id: 'e9',
      similarity: 0.78,
    }),
    chunk('stale', 'an old unrelated note', { similarity: 0.9, created_at: '2020-01-01T00:00:00.000Z' }),
  ];

  it('prefers the exact-term chunk and excludes the duplicate via MMR', () => {
    const { context } = rankCandidates('nemotron-3-embed-1b', docs, { topK: 2, neighbourBudget: 0 });
    const ids = context.map((c) => c.id);
    expect(ids[0]).toBe('exact');
    expect(ids).not.toContain('dupe');
  });

  it('keeps the final context within topK + expansion budget', () => {
    const { context, expanded } = rankCandidates('dimensions', docs, { topK: 2, neighbourBudget: 2 });
    expect(context.length).toBeLessThanOrEqual(2 + expanded.length);
  });

  it('returns nothing for no candidates', () => {
    expect(rankCandidates('q', []).context).toEqual([]);
  });

  it('exposes a score for every candidate', () => {
    const { scores } = rankCandidates('dns router', docs, { topK: 3 });
    for (const d of docs) expect(scores.get(d.id)).toBeTypeOf('number');
  });

  it('is deterministic', () => {
    const a = rankCandidates('nemotron', docs, { topK: 3 }).context.map((c) => c.id);
    const b = rankCandidates('nemotron', docs, { topK: 3 }).context.map((c) => c.id);
    expect(a).toEqual(b);
  });
});

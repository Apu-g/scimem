/**
 * Deterministic retrieval ranking — no model calls, no network, microseconds.
 *
 * The vector search (match_chunks) is good at "topically close" and bad at three
 * things that decide whether an answer is actually useful:
 *   1. redundancy — the top 12 chunks are often the same paragraph repeated, so
 *      the model burns tokens re-reading one idea;
 *   2. exact terms — a query naming "Nemotron-3-Embed-1B" should rank the chunk
 *      containing that exact string above a merely similar paraphrase, and pure
 *      cosine similarity often does not;
 *   3. context gaps — the winning chunk's neighbours (same event, adjacent index)
 *      often hold the qualifier that makes it interpretable.
 *
 * So: BM25 + cosine + recency blended into one score, Maximal Marginal Relevance
 * to kill redundancy, and an A* best-first pass that walks to sibling chunks only
 * when they are close enough to be worth the tokens. All three are deterministic
 * and unit-tested in rank.test.ts.
 */

export interface Rankable {
  id: string;
  event_id: string | null;
  content: string;
  similarity: number | null;
  created_at?: string | null;
  chunk_index?: number | null;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'its', 'me', 'of', 'on', 'or', 'that', 'the', 'their',
  'them', 'there', 'these', 'this', 'to', 'was', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'you', 'your',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * BM25 over the candidate set. IDF comes from the candidates themselves, which
 * is the right corpus here: we are ranking 12 retrieved chunks, not a whole
 * project, so a term that appears in every candidate is genuinely not
 * discriminative for this query.
 */
export function bm25Scores(query: string, docs: string[], k1 = 1.2, b = 0.75): number[] {
  const qTokens = tokenize(query);
  const docTokens = docs.map((d) => tokenize(d));
  const lengths = docTokens.map((t) => t.length);
  const avgLen = lengths.reduce((a, n) => a + n, 0) / Math.max(1, docTokens.length);
  const N = docs.length || 1;

  return docTokens.map((tokens) => {
    if (tokens.length === 0) return 0;
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

    let score = 0;
    for (const q of new Set(qTokens)) {
      const tf = counts.get(q);
      if (!tf) continue;
      const n = docTokens.reduce((sum, t) => sum + (t.includes(q) ? 1 : 0), 0);
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const norm = tf + k1 * (1 - b + (b * tokens.length) / Math.max(1, avgLen));
      score += idf * ((tf * (k1 + 1)) / norm);
    }
    return score;
  });
}

/** Exponential decay to 0.5 at `halfLifeDays`; unknown timestamps score 0.5. */
export function recencyWeight(createdAt: string | null | undefined, now: number, halfLifeDays = 30): number {
  if (!createdAt) return 0.5;
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) return 0.5;
  const days = Math.max(0, (now - ts) / 86_400_000);
  return Math.pow(0.5, days / halfLifeDays);
}

/** Exact-phrase bonus: the query string appearing verbatim is strong evidence. */
export function phraseBonus(query: string, doc: string): number {
  const q = query.trim().toLowerCase();
  if (q.length < 4) return 0;
  return doc.toLowerCase().includes(q) ? 1 : 0;
}

export interface HybridWeights {
  vector: number;
  lexical: number;
  recency: number;
  phrase: number;
}

/**
 * Blend the signals into one 0..1-ish score. Weights favour the vector (it is
 * the only one that understands synonyms) but let an exact term or a very recent
 * capture override it.
 */
export function hybridScore(
  input: { vector: number | null; bm25: number; recency: number; phrase: number },
  weights: HybridWeights = { vector: 0.55, lexical: 0.25, recency: 0.12, phrase: 0.08 },
): number {
  const v = input.vector ?? 0;
  const lex = Math.min(1, input.bm25 / 6); // ~6 is a strong hit in a 12-doc corpus
  return (
    weights.vector * v +
    weights.lexical * lex +
    weights.recency * input.recency +
    weights.phrase * input.phrase
  );
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/**
 * Maximal Marginal Relevance: pick the best-scoring candidate, then repeatedly
 * pick whichever remaining candidate is most *different* from what is already
 * picked, trading relevance against redundancy. λ=1 is pure relevance,
 * λ=0 is pure diversity; 0.7 keeps answers on-topic while stopping the model
 * from seeing the same paragraph five times.
 */
export function mmrSelect<T extends { content: string }>(
  ranked: Ranked<T>[],
  k: number,
  lambda = 0.7,
): T[] {
  if (ranked.length === 0 || k <= 0) return [];
  const pool = ranked.map((r) => ({ ...r, tokens: new Set(tokenize(r.item.content)) }));
  const maxScore = Math.max(...pool.map((p) => p.score)) || 1;
  const picked: typeof pool = [];

  while (picked.length < k && pool.length > 0) {
    let bestIdx = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i]!;
      let maxSim = 0;
      for (const chosen of picked) {
        const sim = jaccard(candidate.tokens, chosen.tokens);
        if (sim > maxSim) maxSim = sim;
      }
      const relevance = candidate.score / maxScore;
      const value = lambda * relevance - (1 - lambda) * maxSim;
      if (value > bestValue) {
        bestValue = value;
        bestIdx = i;
      }
    }
    picked.push(...pool.splice(bestIdx, 1));
  }
  return picked.map((p) => p.item);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * A* best-first expansion over chunk neighbours.
 *
 * Nodes are chunks; the frontier starts at the best-ranked seeds. g(n) is the
 * cost already paid to reach n (its distance from the nearest seed), h(n) is the
 * cost of ignoring it (how far below the seed's score it sits). We stop as soon
 * as the cheapest remaining node cannot beat the budget, so we only pull in
 * siblings that genuinely help — a qualifier two chunks away from the match —
 * instead of widening the context indiscriminately.
 *
 * `neighbours` supplies the edges (same event, adjacent index). Pure and
 * synchronous, so the whole policy is testable without a database.
 */
export function astarExpand<T extends Rankable>(
  seeds: T[],
  all: T[],
  opts: {
    neighbours: (node: T) => T[];
    /** nodes scoring below seedScore * ratio are never worth their tokens */
    ratio?: number;
    /** hard cap on extra nodes */
    budget?: number;
    /** g step per hop; larger = only immediate siblings get pulled in */
    hopCost?: number;
  },
): T[] {
  const { neighbours, ratio = 0.75, budget = 3, hopCost = 0.05 } = opts;
  if (seeds.length === 0 || budget <= 0) return [];

  const bestSeed = Math.max(...seeds.map((s) => scoreOf(s)));
  const floor = bestSeed * ratio;
  const seen = new Set(seeds.map((s) => s.id));
  const pool = new Map(all.map((n) => [n.id, n]));

  interface Node {
    node: T;
    g: number;
    h: number;
    f: number;
  }
  const open: Node[] = seeds.map((node) => {
    const h = Math.max(0, bestSeed - scoreOf(node));
    return { node, g: 0, h, f: h };
  });

  const added: T[] = [];
  while (open.length > 0 && added.length < budget) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;

    for (const next of neighbours(current.node)) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      const raw = pool.get(next.id) ?? next;
      const g = current.g + hopCost;
      const h = Math.max(0, bestSeed - scoreOf(raw));
      // a sibling below the floor can never be reached without paying more than
      // the whole budget, so record it and move on
      if (scoreOf(raw) < floor) continue;
      open.push({ node: raw, g, h, f: g + h });
      added.push(raw);
      if (added.length >= budget) break;
    }
  }
  return added;
}

/** Score stamped by rankCandidates; falls back to the raw vector similarity. */
function scoreOf(node: Rankable & { score?: number }): number {
  return node.score ?? node.similarity ?? 0;
}

/**
 * The full deterministic pipeline: blend → order → expand with siblings →
 * deduplicate with MMR. Returns the final context set plus the extras A* pulled
 * in (the trace view shows these as "pulled in by context expansion").
 */
export function rankCandidates<T extends Rankable>(
  query: string,
  candidates: T[],
  opts: {
    now?: number;
    topK?: number;
    lambda?: number;
    neighbourBudget?: number;
    weights?: HybridWeights;
  } = {},
): { context: T[]; expanded: T[]; scores: Map<string, number> } {
  const { now = Date.now(), topK = 5, lambda = 0.7, neighbourBudget = 3, weights } = opts;
  if (candidates.length === 0) return { context: [], expanded: [], scores: new Map() };

  const bm25 = bm25Scores(query, candidates.map((c) => c.content));
  const scored: Ranked<T & { score: number }>[] = candidates.map((item, i) => ({
    item: {
      ...item,
      score: hybridScore(
        {
          vector: item.similarity,
          bm25: bm25[i] ?? 0,
          recency: recencyWeight(item.created_at, now),
          phrase: phraseBonus(query, item.content),
        },
        weights,
      ),
    } as T & { score: number },
    score: 0,
  }));
  // recompute cleanly (the map above needs the final score for MMR)
  const ranked = scored
    .map((s) => ({ item: s.item, score: s.item.score }))
    .sort((a, b) => b.score - a.score);

  const seeds = ranked.slice(0, topK).map((r) => r.item);
  const seedIds = new Set(seeds.map((s) => s.id));

  const expanded = astarExpand(seeds, candidates, {
    neighbours: (node) =>
      candidates.filter(
        (c) => c.id !== node.id && node.event_id && c.event_id === node.event_id,
      ),
    budget: neighbourBudget,
  });

  const pool = [...ranked.map((r) => r.item), ...expanded].sort((a, b) => scoreOf(b) - scoreOf(a));
  const context = mmrSelect(
    pool.map((item) => ({ item, score: scoreOf(item) })),
    topK + expanded.length,
    lambda,
  ).filter((c) => seedIds.has(c.id) || expanded.some((e) => e.id === c.id));

  const scores = new Map<string, number>();
  for (const item of pool) scores.set(item.id, scoreOf(item));
  return { context, expanded, scores };
}

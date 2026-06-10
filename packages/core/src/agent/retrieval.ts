import type { Memory, RetrievalScore, SimMinutes } from "@virtual-sim/shared";

export interface ScoredMemory {
  memory: Memory;
  score: RetrievalScore;
}

export interface RetrievalParams {
  topK: number;
  weights: { recency: number; importance: number; relevance: number };
  /** Per-sim-hour exponential decay base (paper: 0.995). */
  decay: number;
  /** Cap on candidate set size (most recent N). */
  maxCandidates?: number;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function minMax(values: number[]): (v: number) => number {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range === 0) return () => 0.5;
  return (v: number) => (v - min) / range;
}

/**
 * Paper-faithful retrieval:
 *   score = w_r * norm(recency) + w_i * norm(importance) + w_v * norm(relevance)
 *   recency_i = decay ^ (sim-hours since lastAccessed)
 *
 * The caller is responsible for touching lastAccessedSim on the returned
 * memories (StorePort.touchMemories) — that "rehearsal" effect is part of
 * the paper's design.
 */
export function retrieve(
  candidates: Array<{ memory: Memory; embedding: Float32Array }>,
  queryEmbedding: Float32Array,
  now: SimMinutes,
  params: RetrievalParams,
): ScoredMemory[] {
  let pool = candidates;
  if (params.maxCandidates && pool.length > params.maxCandidates) {
    pool = pool.slice(pool.length - params.maxCandidates);
  }
  if (pool.length === 0) return [];

  const recencies = pool.map(({ memory }) => {
    const hours = Math.max(0, (now - memory.lastAccessedSim) / 60);
    return Math.pow(params.decay, hours);
  });
  const importances = pool.map(({ memory }) => memory.importance / 10);
  const relevances = pool.map(({ embedding }) => cosine(queryEmbedding, embedding));

  const nr = minMax(recencies);
  const ni = minMax(importances);
  const nv = minMax(relevances);

  const scored: ScoredMemory[] = pool.map((c, i) => {
    const recency = nr(recencies[i]!);
    const importance = ni(importances[i]!);
    const relevance = nv(relevances[i]!);
    const total =
      params.weights.recency * recency +
      params.weights.importance * importance +
      params.weights.relevance * relevance;
    return {
      memory: c.memory,
      score: { memoryId: c.memory.id, recency, importance, relevance, total },
    };
  });

  scored.sort((a, b) => b.score.total - a.score.total);
  return scored.slice(0, params.topK);
}

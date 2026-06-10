import type { Memory, MemoryKind, SimMinutes } from "@virtual-sim/shared";
import type { EmbedderPort, StorePort } from "../ports.js";
import { newId } from "../ports.js";
import { retrieve, type RetrievalParams, type ScoredMemory } from "./retrieval.js";

export interface PendingMemory {
  memory: Memory;
  resolveImportance: (score: number) => void;
}

/**
 * Per-agent memory stream. Holds memories + embeddings in RAM (a few
 * thousand 384-dim vectors — cosine scans are microseconds) and writes
 * through to the store.
 */
export class MemoryStream {
  private entries: Array<{ memory: Memory; embedding: Float32Array }> = [];
  /** Importance accumulated since the last reflection (reflection trigger). */
  importanceSinceReflection = 0;

  constructor(
    public readonly agentId: string,
    private readonly store: StorePort,
    private readonly embedder: EmbedderPort,
  ) {}

  load(rows: Array<{ memory: Memory; embedding: Float32Array }>): void {
    this.entries = [...rows].sort((a, b) => a.memory.createdAtSim - b.memory.createdAtSim);
  }

  get size(): number {
    return this.entries.length;
  }

  all(): ReadonlyArray<{ memory: Memory; embedding: Float32Array }> {
    return this.entries;
  }

  recent(n: number): Memory[] {
    return this.entries.slice(-n).map((e) => e.memory);
  }

  byId(id: string): Memory | undefined {
    return this.entries.find((e) => e.memory.id === id)?.memory;
  }

  /**
   * Append a memory with a known importance score (used for reviewer
   * feedback at importance 9, plans, and pre-scored observations).
   */
  async append(
    kind: MemoryKind,
    content: string,
    importance: number,
    now: SimMinutes,
    citations: string[] = [],
  ): Promise<Memory> {
    const [embedding] = await this.embedder.embed([content]);
    const memory: Memory = {
      id: newId("mem"),
      agentId: this.agentId,
      kind,
      content,
      importance: Math.max(1, Math.min(10, Math.round(importance))),
      createdAtSim: now,
      lastAccessedSim: now,
      citations,
    };
    this.entries.push({ memory, embedding: embedding! });
    this.store.insertMemory(memory, embedding!);
    this.importanceSinceReflection += memory.importance;
    return memory;
  }

  /** Retrieve top-k for a query string; touches lastAccessed on results. */
  async retrieveByQuery(
    query: string,
    now: SimMinutes,
    params: RetrievalParams,
  ): Promise<ScoredMemory[]> {
    if (this.entries.length === 0) return [];
    const [q] = await this.embedder.embed([query]);
    const results = retrieve(this.entries, q!, now, { ...params, maxCandidates: 2000 });
    const ids = results.map((r) => r.memory.id);
    for (const r of results) r.memory.lastAccessedSim = now;
    this.store.touchMemories(ids, now);
    return results;
  }

  /** Retrieve and merge results for several focal points (reflection, dialogue). */
  async retrieveForFocalPoints(
    points: string[],
    now: SimMinutes,
    params: RetrievalParams,
  ): Promise<Map<string, ScoredMemory[]>> {
    const out = new Map<string, ScoredMemory[]>();
    for (const p of points) {
      out.set(p, await this.retrieveByQuery(p, now, params));
    }
    return out;
  }

  resetReflectionAccumulator(): void {
    this.importanceSinceReflection = 0;
  }
}

import { describe, expect, it } from "vitest";
import { cosine, retrieve } from "../src/agent/retrieval.js";
import type { Memory } from "@virtual-sim/shared";

function mem(id: string, importance: number, lastAccessedSim: number): Memory {
  return {
    id,
    agentId: "a",
    kind: "observation",
    content: id,
    importance,
    createdAtSim: lastAccessedSim,
    lastAccessedSim,
    citations: [],
  };
}

function vec(...vals: number[]): Float32Array {
  return new Float32Array(vals);
}

const params = {
  topK: 3,
  weights: { recency: 1, importance: 1, relevance: 1 },
  decay: 0.995,
};

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosine(vec(1, 0), vec(1, 0))).toBeCloseTo(1);
    expect(cosine(vec(1, 0), vec(0, 1))).toBeCloseTo(0);
  });
});

describe("retrieve", () => {
  it("computes recency as decay^hours since last access", () => {
    // Two memories identical except recency: one accessed now, one 100 sim-hours ago.
    const now = 100 * 60;
    const candidates = [
      { memory: mem("old", 5, 0), embedding: vec(1, 0) },
      { memory: mem("new", 5, now), embedding: vec(1, 0) },
    ];
    const res = retrieve(candidates, vec(1, 0), now, { ...params, topK: 2 });
    expect(res[0]!.memory.id).toBe("new");
    // raw recency for old = 0.995^100 ≈ 0.6058; after min-max with new (=1) old normalizes to 0.
    expect(res.find((r) => r.memory.id === "old")!.score.recency).toBe(0);
    expect(res.find((r) => r.memory.id === "new")!.score.recency).toBe(1);
  });

  it("ranks by the equal-weight sum of normalized components", () => {
    const now = 60;
    const candidates = [
      // High importance, low relevance
      { memory: mem("important", 10, now), embedding: vec(0, 1) },
      // Low importance, high relevance
      { memory: mem("relevant", 1, now), embedding: vec(1, 0) },
      // Middle on both — never normalized to the top of any component
      { memory: mem("middling", 5, now), embedding: vec(0.7, 0.7) },
    ];
    const res = retrieve(candidates, vec(1, 0), now, params);
    const ids = res.map((r) => r.memory.id);
    // important: imp=1, rel=0 → 1+ recency(0.5). relevant: imp=0, rel=1 → 1+0.5.
    // middling: imp≈0.44, rel≈0.707 normalized between → strictly between.
    expect(ids).toHaveLength(3);
    expect(res[0]!.score.total).toBeGreaterThanOrEqual(res[1]!.score.total);
    expect(res[1]!.score.total).toBeGreaterThanOrEqual(res[2]!.score.total);
  });

  it("returns topK results only", () => {
    const now = 0;
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      memory: mem(`m${i}`, (i % 10) + 1, 0),
      embedding: vec(1, 0),
    }));
    expect(retrieve(candidates, vec(1, 0), now, params)).toHaveLength(3);
  });

  it("handles uniform components without NaN (zero range)", () => {
    const now = 0;
    const candidates = [
      { memory: mem("a", 5, 0), embedding: vec(1, 0) },
      { memory: mem("b", 5, 0), embedding: vec(1, 0) },
    ];
    const res = retrieve(candidates, vec(1, 0), now, { ...params, topK: 2 });
    for (const r of res) {
      expect(Number.isFinite(r.score.total)).toBe(true);
      expect(r.score.recency).toBe(0.5);
    }
  });

  it("caps the candidate pool at maxCandidates (most recent kept)", () => {
    const now = 1000;
    const candidates = Array.from({ length: 50 }, (_, i) => ({
      memory: mem(`m${i}`, 5, i),
      embedding: vec(1, 0),
    }));
    const res = retrieve(candidates, vec(1, 0), now, { ...params, topK: 50, maxCandidates: 10 });
    expect(res).toHaveLength(10);
    expect(res.every((r) => Number(r.memory.id.slice(1)) >= 40)).toBe(true);
  });
});

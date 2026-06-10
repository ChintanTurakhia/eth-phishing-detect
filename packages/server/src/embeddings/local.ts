import type { EmbedderPort } from "@virtual-sim/core";

const DIM = 384;

/**
 * Local MiniLM embeddings via @xenova/transformers (ONNX, downloaded on
 * first use). If the model can't load (offline environment), falls back to
 * a deterministic hashed bag-of-words embedding — far weaker semantically,
 * but keeps the whole sim functional with zero network.
 */
export class LocalEmbedder implements EmbedderPort {
  readonly dimensions = DIM;
  private pipe: ((texts: string[], opts: object) => Promise<{ tolist(): number[][] }>) | null = null;
  private loadFailed = false;
  private loading: Promise<void> | null = null;

  private async ensureLoaded(): Promise<void> {
    if (this.pipe || this.loadFailed) return;
    this.loading ??= (async () => {
      try {
        const { pipeline } = await import("@xenova/transformers");
        const p = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          quantized: true,
        });
        this.pipe = p as unknown as typeof this.pipe extends infer T ? Exclude<T, null> : never;
      } catch (err) {
        console.warn(
          `[embeddings] MiniLM unavailable (${(err as Error).message?.slice(0, 80)}); using hashed fallback`,
        );
        this.loadFailed = true;
      }
    })();
    await this.loading;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.ensureLoaded();
    if (this.pipe) {
      const out = await this.pipe(texts, { pooling: "mean", normalize: true });
      const list = out.tolist();
      return list.map((v) => new Float32Array(v));
    }
    return texts.map(hashEmbed);
  }
}

/** Deterministic hashed bag-of-words fallback (normalized). */
export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % DIM;
    v[idx] = v[idx]! + 1;
    // A second hash position reduces collisions.
    const idx2 = Math.abs(Math.imul(h, 31)) % DIM;
    v[idx2] = v[idx2]! + 0.5;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i]! /= norm;
  return v;
}

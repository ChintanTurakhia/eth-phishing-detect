import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LlmPort, LlmRequest, LlmResponse, ToolLoopRequest, ToolLoopResult } from "@virtual-sim/core";

type Mode = "record" | "replay" | "bypass";

/**
 * Record/replay wrapper around any LlmPort. Keys responses by a hash of the
 * request so a recorded sim run replays deterministically in CI without an
 * API key. Tool loops are not cassette-able (side effects) — they pass
 * through, so use the MockLlm for offline work sessions.
 */
export class CassetteLlm implements LlmPort {
  private tape: Record<string, LlmResponse> = {};
  private dirty = false;

  constructor(
    private readonly inner: LlmPort,
    private readonly path: string,
    private readonly mode: Mode,
  ) {
    if (mode !== "bypass" && existsSync(path)) {
      this.tape = JSON.parse(readFileSync(path, "utf8")) as Record<string, LlmResponse>;
    }
  }

  private key(req: LlmRequest): string {
    const h = createHash("sha256");
    h.update(req.purpose);
    h.update(req.system.map((b) => b.text).join("\n---\n"));
    h.update(req.user);
    return h.digest("hex").slice(0, 24);
  }

  async call(req: LlmRequest): Promise<LlmResponse> {
    if (this.mode === "bypass") return this.inner.call(req);
    const k = this.key(req);
    if (this.mode === "replay") {
      const hit = this.tape[k];
      if (hit) return hit;
      throw new Error(`cassette miss for purpose=${req.purpose} key=${k}`);
    }
    const res = await this.inner.call(req);
    this.tape[k] = res;
    this.dirty = true;
    return res;
  }

  toolLoop(req: ToolLoopRequest): Promise<ToolLoopResult> {
    return this.inner.toolLoop(req);
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.tape, null, 2));
    this.dirty = false;
  }
}

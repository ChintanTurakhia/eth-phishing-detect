import type { SimMinutes, WorldEvent } from "@virtual-sim/shared";

/**
 * Per-agent perception dedupe: an agent should not re-observe the same
 * (subject, predicate, object) within a short window.
 */
export class SeenCache {
  private seen = new Map<string, SimMinutes>();

  constructor(private readonly windowMin = 45) {}

  /** Returns true when the event is novel for this agent (and records it). */
  novel(e: WorldEvent, now: SimMinutes): boolean {
    const key = `${e.subject}|${e.predicate}|${e.object}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMin) return false;
    this.seen.set(key, now);
    if (this.seen.size > 500) {
      for (const [k, t] of this.seen) {
        if (now - t >= this.windowMin) this.seen.delete(k);
      }
    }
    return true;
  }
}

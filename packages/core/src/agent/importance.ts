import { importanceScoresJsonSchema, importanceScoresZ } from "@virtual-sim/shared";
import type { LlmPort } from "../ports.js";
import { PRIORITY } from "../sim/scheduler.js";
import { importancePrompt } from "./prompts.js";

interface QueueItem {
  text: string;
  resolve: (score: number) => void;
}

/**
 * Batched importance (poignancy) scorer on the utility model.
 * Items queue up and flush in batches of up to 10.
 *
 * Deliberately NOT routed through the Scheduler: callers awaiting score()
 * may themselves hold scheduler slots, so a scheduled flush could starve
 * behind them and deadlock. Haiku batch calls are cheap; they run direct.
 */
export class ImportanceScorer {
  private queue: QueueItem[] = [];
  private inFlight = 0;

  constructor(
    private readonly llm: LlmPort,
    private readonly batchSize = 10,
  ) {}

  /** True while scores are queued or being fetched (used by quiesce). */
  get busy(): boolean {
    return this.queue.length > 0 || this.inFlight > 0;
  }

  score(text: string): Promise<number> {
    return new Promise((resolve) => {
      this.queue.push({ text, resolve });
      if (this.queue.length >= this.batchSize) void this.flush();
    });
  }

  /** Called once per tick by the sim loop to flush stragglers. */
  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      this.inFlight += batch.length;
      try {
        const res = await this.llm.call({
          tier: "utility",
          purpose: "importance",
          system: [],
          user: importancePrompt(batch.map((b) => b.text)),
          jsonSchema: importanceScoresJsonSchema,
          maxTokens: 256,
          priority: PRIORITY.importance,
        });
        const parsed = importanceScoresZ.safeParse(JSON.parse(res.text));
        const scores = parsed.success ? parsed.data.scores : [];
        batch.forEach((item, i) => item.resolve(clamp(scores[i] ?? 3)));
      } catch {
        // Scoring failure should never stall the sim — fall back to neutral.
        batch.forEach((item) => item.resolve(3));
      } finally {
        this.inFlight -= batch.length;
      }
    }
  }
}

function clamp(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

/**
 * LLM scheduler: bounded concurrency, priority queue, coalescing keys.
 * Budget enforcement lives in the server's LlmPort implementation; the
 * scheduler only sequences calls.
 */

interface Job<T> {
  priority: number;
  key: string | null;
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export const PRIORITY = {
  dialogue: 0,
  react: 1,
  plan: 2,
  work: 2,
  reflect: 3,
  importance: 4,
} as const;

export class Scheduler {
  private queue: Job<unknown>[] = [];
  private running = 0;
  private pendingKeys = new Set<string>();

  constructor(private concurrency: number) {}

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.pump();
  }

  get pending(): number {
    return this.queue.length + this.running;
  }

  /**
   * Enqueue a job. If `key` is given and a job with the same key is already
   * queued or running, the new job is dropped (resolved with null) — this is
   * how duplicate cognition triggers coalesce.
   */
  schedule<T>(priority: number, run: () => Promise<T>, key?: string): Promise<T | null> {
    if (key && this.pendingKeys.has(key)) {
      return Promise.resolve(null);
    }
    if (key) this.pendingKeys.add(key);
    return new Promise<T | null>((resolve, reject) => {
      const job: Job<T | null> = {
        priority,
        key: key ?? null,
        run: run as () => Promise<T | null>,
        resolve,
        reject,
      };
      this.queue.push(job as Job<unknown>);
      this.queue.sort((a, b) => a.priority - b.priority);
      this.pump();
    });
  }

  /** Resolves when all queued and running jobs have settled. */
  async drain(): Promise<void> {
    while (this.pending > 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running += 1;
      job
        .run()
        .then((v) => job.resolve(v))
        .catch((e) => job.reject(e))
        .finally(() => {
          this.running -= 1;
          if (job.key) this.pendingKeys.delete(job.key);
          this.pump();
        });
    }
  }
}

import { describe, expect, it } from "vitest";
import { Scheduler } from "../src/sim/scheduler.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Scheduler", () => {
  it("respects the concurrency limit", async () => {
    const s = new Scheduler(2);
    let running = 0;
    let peak = 0;
    const job = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(20);
      running -= 1;
    };
    await Promise.all([1, 2, 3, 4, 5].map(() => s.schedule(1, job)));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("runs lower priority numbers first", async () => {
    const s = new Scheduler(1);
    const order: string[] = [];
    // Occupy the single slot so the rest queue up and sort.
    const blocker = s.schedule(0, async () => {
      await sleep(30);
    });
    const jobs = [
      s.schedule(3, async () => void order.push("reflect")),
      s.schedule(1, async () => void order.push("react")),
      s.schedule(0, async () => void order.push("dialogue")),
    ];
    await Promise.all([blocker, ...jobs]);
    expect(order).toEqual(["dialogue", "react", "reflect"]);
  });

  it("coalesces jobs with the same key", async () => {
    const s = new Scheduler(1);
    let runs = 0;
    const job = async () => {
      await sleep(20);
      runs += 1;
      return "ran";
    };
    const [a, b, c] = await Promise.all([
      s.schedule(1, job, "k"),
      s.schedule(1, job, "k"),
      s.schedule(1, job, "k"),
    ]);
    expect(runs).toBe(1);
    expect([a, b, c].filter((r) => r === "ran")).toHaveLength(1);
    expect([a, b, c].filter((r) => r === null)).toHaveLength(2);
  });

  it("drain resolves after all work settles", async () => {
    const s = new Scheduler(2);
    let done = 0;
    for (let i = 0; i < 5; i++) {
      void s.schedule(1, async () => {
        await sleep(10);
        done += 1;
      });
    }
    await s.drain();
    expect(done).toBe(5);
  });
});

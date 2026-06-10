import type { SimMinutes } from "@virtual-sim/shared";

/**
 * Discrete sim clock. 1 tick = 1 sim-minute. The owner (Simulation) calls
 * tick(); wall pacing is handled outside via setInterval at 1000/speed ms.
 */
export class GameClock {
  private t: SimMinutes;

  constructor(start: SimMinutes = 8 * 60) {
    this.t = start;
  }

  get now(): SimMinutes {
    return this.t;
  }

  tick(): SimMinutes {
    this.t += 1;
    return this.t;
  }

  set(simTime: SimMinutes): void {
    this.t = simTime;
  }
}

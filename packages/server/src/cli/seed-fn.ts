/**
 * Core seeding logic — adds grounding memories to all agents.
 * Does NOT wipe the database; callers are responsible for that.
 */
import type { SimHost } from "../host.js";

const SEEDS: Record<string, string[]> = {
  pm: [
    "The Q3 roadmap has two bets: Data Out (exports, read API) and First-Five-Minutes onboarding",
    "Maxwell Corp's $240k renewal is blocked on nightly CSV exports (LUM-341)",
    "Activation research: users who apply a template in session one activate at 3.4x the rate",
  ],
  engineer: [
    "The Q3 roadmap priorities are the export pipeline and the read API",
    "The dashboard p95 load time regressed to 4.1s after the panel-grid refactor (LUM-377)",
    "INC-88 postmortem left an open action item: separate the backfill queue",
  ],
};

export async function seedAgents(host: SimHost): Promise<void> {
  for (const agent of host.sim.agents.values()) {
    const lines = SEEDS[agent.soul.role] ?? SEEDS.engineer!;
    for (const line of lines) {
      await agent.memory.append("observation", line, 6, host.sim.clock.now);
    }
  }
}

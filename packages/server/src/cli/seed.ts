/**
 * Seed the sim DB: fresh agents from souls/ plus a few grounding memories
 * (roadmap context) so day-one planning has something to retrieve.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { SimHost } from "../host.js";

const root = resolve(import.meta.dirname, "../../../..");
const dbPath = process.env.DATABASE_PATH ?? resolve(root, "data/sim.db");

rmSync(dbPath, { force: true });
rmSync(dbPath + "-wal", { force: true });
rmSync(dbPath + "-shm", { force: true });

const host = new SimHost({
  dbPath,
  soulsDir: resolve(root, "souls"),
  worldPath: resolve(root, "worlds/office.json"),
  fixturesDir: resolve(root, "fixtures"),
});
await host.init();

const seeds: Record<string, string[]> = {
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

for (const agent of host.sim.agents.values()) {
  const lines = seeds[agent.soul.role] ?? seeds.engineer!;
  for (const line of lines) {
    await agent.memory.append("observation", line, 6, host.sim.clock.now);
  }
}

console.log(`seeded ${dbPath} with ${host.sim.agents.size} agents:`);
for (const a of host.sim.agents.values()) {
  console.log(`  - ${a.name} (${a.soul.role}) — ${a.memory.size} seed memories`);
}
process.exit(0);

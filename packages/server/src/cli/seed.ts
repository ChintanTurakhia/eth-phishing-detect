/**
 * Seed the sim DB: wipe, recreate agents from souls/, add grounding memories.
 * For production first-run seeding, index.ts calls seedAgents() directly
 * so no data is wiped on restart.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { SimHost } from "../host.js";
import { seedAgents } from "./seed-fn.js";

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
await seedAgents(host);

console.log(`seeded ${dbPath} with ${host.sim.agents.size} agents:`);
for (const a of host.sim.agents.values()) {
  console.log(`  - ${a.name} (${a.soul.role}) — ${a.memory.size} seed memories`);
}
process.exit(0);

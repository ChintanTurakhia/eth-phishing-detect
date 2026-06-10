/**
 * Headless sim runner: advances the clock as fast as cognition allows and
 * prints a readable trace. Usage:
 *   pnpm sim:run -- --minutes 240
 */
import { resolve } from "node:path";
import { formatSimTime } from "@virtual-sim/shared";
import { SimHost } from "../host.js";

const args = process.argv.slice(2);
const minutesIdx = args.indexOf("--minutes");
const minutes = minutesIdx >= 0 ? Number(args[minutesIdx + 1]) : 120;

const root = resolve(import.meta.dirname, "../../../..");
const host = new SimHost({
  dbPath: process.env.DATABASE_PATH ?? resolve(root, "data/sim.db"),
  soulsDir: resolve(root, "souls"),
  worldPath: resolve(root, "worlds/office.json"),
  fixturesDir: resolve(root, "fixtures"),
});
await host.init();

host.events.on("event", (e: { type: string; payload: Record<string, unknown> }) => {
  const t = formatSimTime(host.sim.clock.now);
  const p = e.payload;
  switch (e.type) {
    case "agent.action": {
      const agent = host.sim.agents.get(p.agentId as string);
      console.log(`${t}  ▶ ${agent?.name}: ${p.description as string} @ ${p.location as string}`);
      break;
    }
    case "dialogue.utterance": {
      const u = p.utterance as { content: string };
      console.log(`${t}  💬 ${p.agentName as string}: ${u.content}`);
      break;
    }
    case "dialogue.ended":
      console.log(`${t}  🤝 conversation ended: ${p.summary as string}`);
      break;
    case "reflection.created": {
      const m = p.memory as { content: string };
      console.log(`${t}  🪞 reflection: ${m.content}`);
      break;
    }
    case "artifact.created": {
      const a = p.artifact as { title: string; type: string };
      console.log(`${t}  📦 ARTIFACT [${a.type}] ${a.title}`);
      break;
    }
    case "world.event":
      break; // covered by agent.action
  }
});

console.log(`running ${minutes} sim-minutes from ${formatSimTime(host.sim.clock.now)} (llm: ${host.llmMode})…\n`);
await host.runFor(minutes);

console.log(`\ndone at ${formatSimTime(host.sim.clock.now)}.`);
for (const a of host.sim.agents.values()) {
  console.log(`  ${a.name}: ${a.memory.size} memories, ${a.plans.length} plan items, status=${a.state.status}`);
}
const pending = host.store.listArtifacts("pending");
console.log(`  review queue: ${pending.length} pending artifact(s)`);
for (const art of pending) console.log(`    - [${art.type}] ${art.title}`);
process.exit(0);

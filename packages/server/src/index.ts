import Fastify from "fastify";
import cors from "@fastify/cors";
import chokidar from "chokidar";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { SimHost } from "./host.js";
import { attachWs } from "./api/ws.js";
import { registerRest } from "./api/rest.js";

const root = resolve(import.meta.dirname, "../../..");
const opts = {
  dbPath: process.env.DATABASE_PATH ?? resolve(root, "data/sim.db"),
  soulsDir: resolve(root, "souls"),
  worldPath: resolve(root, "worlds/office.json"),
  fixturesDir: resolve(root, "fixtures"),
};

const host = new SimHost(opts);
await host.init();

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });
registerRest(app, host, opts.soulsDir);

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
attachWs(app.server, host);

// Hot-reload souls on file change.
chokidar
  .watch(opts.soulsDir, { ignoreInitial: true })
  .on("change", (path) => {
    const file = basename(path);
    if (!file.endsWith(".soul.md")) return;
    try {
      host.saveSoul(file, readFileSync(path, "utf8"));
      console.log(`[souls] reloaded ${file}`);
    } catch (err) {
      console.warn(`[souls] reload failed for ${file}: ${(err as Error).message}`);
    }
  });

console.log(`virtual-sim server on :${port} (llm: ${host.llmMode}, agents: ${host.sim.agents.size})`);
console.log(`ws: ws://localhost:${port}/ws  rest: http://localhost:${port}/api/state`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void host.pause().then(() => process.exit(0));
  });
}

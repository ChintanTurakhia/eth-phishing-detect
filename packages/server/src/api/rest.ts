import type { FastifyInstance } from "fastify";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SimHost } from "../host.js";

export function registerRest(app: FastifyInstance, host: SimHost, soulsDir: string): void {
  app.get("/api/state", async () => host.snapshot());

  app.get("/api/agents/:id/memories", async (req) => {
    const { id } = req.params as { id: string };
    const { limit = "200", kind } = req.query as { limit?: string; kind?: string };
    const agent = host.sim.agents.get(id);
    if (!agent) return { memories: [] };
    let memories = agent.memory.all().map((e) => e.memory);
    if (kind) memories = memories.filter((m) => m.kind === kind);
    return { memories: memories.slice(-Number(limit)).reverse() };
  });

  // Retrieval debugger: run the real scoring against an agent's stream.
  app.get("/api/agents/:id/retrieve", async (req) => {
    const { id } = req.params as { id: string };
    const { q = "" } = req.query as { q?: string };
    const agent = host.sim.agents.get(id);
    if (!agent || !q) return { results: [] };
    const results = await agent.memory.retrieveByQuery(q, host.sim.clock.now, host.sim.retrievalParams);
    return {
      results: results.map((r) => ({ memory: r.memory, score: r.score })),
    };
  });

  app.get("/api/agents/:id/plans", async (req) => {
    const { id } = req.params as { id: string };
    const agent = host.sim.agents.get(id);
    return { items: agent ? agent.plans : [] };
  });

  app.get("/api/artifacts", async (req) => {
    const { status } = req.query as { status?: string };
    return { artifacts: host.store.listArtifacts(status) };
  });

  app.post("/api/artifacts/:id/review", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { decision, reason = "" } = req.body as { decision: "accepted" | "rejected"; reason?: string };
    if (decision !== "accepted" && decision !== "rejected") {
      return reply.code(400).send({ error: "decision must be accepted|rejected" });
    }
    const artifact = await host.reviewArtifact(id, decision, reason);
    if (!artifact) return reply.code(404).send({ error: "not found" });
    return { artifact };
  });

  app.get("/api/conversations", async () => ({
    conversations: host.store.recentConversations(50),
  }));

  app.get("/api/conversations/:id/utterances", async (req) => {
    const { id } = req.params as { id: string };
    return { utterances: host.store.listUtterances(id) };
  });

  app.get("/api/souls", async () => {
    const files = readdirSync(soulsDir).filter((f) => f.endsWith(".soul.md"));
    return {
      souls: files.map((f) => ({ fileName: f, content: readFileSync(join(soulsDir, f), "utf8") })),
    };
  });

  app.post("/api/souls", async (req, reply) => {
    const { fileName, content } = req.body as { fileName: string; content: string };
    try {
      host.saveSoul(fileName, content);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/api/settings", async () => host.settings);

  app.patch("/api/settings", async (req) => host.updateSettings(req.body as object));
}

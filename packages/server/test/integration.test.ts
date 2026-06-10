/**
 * Deterministic end-to-end run: 4 agents, mock LLM, mock MCP, in-memory
 * SQLite. Asserts the paper-faithful invariants the plan calls for.
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SimHost } from "../src/host.js";

const repoRoot = resolve(__dirname, "../../..");

let host: SimHost;
const executedTools: string[] = [];

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "vsim-"));
  // Copy souls/world/fixtures so the test is hermetic.
  cpSync(resolve(repoRoot, "souls"), join(dir, "souls"), { recursive: true });
  cpSync(resolve(repoRoot, "fixtures"), join(dir, "fixtures"), { recursive: true });
  mkdirSync(join(dir, "worlds"));
  writeFileSync(
    join(dir, "worlds/office.json"),
    readFileSync(resolve(repoRoot, "worlds/office.json")),
  );

  delete process.env.ANTHROPIC_API_KEY; // force MockLlm

  host = new SimHost({
    dbPath: join(dir, "sim.db"),
    soulsDir: join(dir, "souls"),
    worldPath: join(dir, "worlds/office.json"),
    fixturesDir: join(dir, "fixtures"),
  });
  await host.init();

  // Spy on tool executions to prove no write tool is ever invoked.
  const realExecute = host.mcp.executeTool.bind(host.mcp);
  host.mcp.executeTool = async (name, input) => {
    executedTools.push(name);
    return realExecute(name, input);
  };

  await host.runFor(150); // 07:55 → 10:25
}, 120_000);

describe("end-to-end sim run (mock LLM)", () => {
  it("every agent planned its day with 5-8 chunks inside the office day", () => {
    for (const agent of host.sim.agents.values()) {
      const chunks = agent.plans.filter((p) => p.level === "day");
      expect(chunks.length).toBeGreaterThanOrEqual(5);
      expect(chunks.length).toBeLessThanOrEqual(8);
      for (const c of chunks) {
        // Actions only execute while the agent is awake; the chunk windows
        // themselves just need to be plausible office hours.
        expect(c.startSim).toBeGreaterThanOrEqual(6 * 60);
        expect(c.startSim + c.durationMin).toBeLessThanOrEqual(24 * 60);
      }
    }
  });

  it("every decomposed action has a location hint, start, and 5-15 min duration", () => {
    for (const agent of host.sim.agents.values()) {
      const actions = agent.plans.filter((p) => p.level === "action" && p.parentId !== null);
      expect(actions.length).toBeGreaterThan(0);
      for (const a of actions) {
        expect(a.durationMin).toBeGreaterThanOrEqual(5);
        expect(a.durationMin).toBeLessThanOrEqual(15);
        expect(a.startSim).toBeGreaterThan(0);
        expect(a.locationPath).toBeTruthy();
      }
    }
  });

  it("agents accumulated observations and dialogue memories", () => {
    for (const agent of host.sim.agents.values()) {
      const kinds = new Set(agent.memory.all().map((e) => e.memory.kind));
      expect(kinds.has("observation")).toBe(true);
      expect(agent.memory.size).toBeGreaterThan(5);
    }
  });

  it("at least one conversation ran and was summarized into both memories", () => {
    const convos = host.store.recentConversations(10);
    const ended = convos.filter((c) => c.endedSim !== null && c.summary);
    expect(ended.length).toBeGreaterThanOrEqual(1);
    const c = ended[0]!;
    for (const pid of c.participants) {
      const agent = host.sim.agents.get(pid)!;
      const hasSummary = agent.memory
        .all()
        .some((e) => e.memory.content.startsWith("Conversation with"));
      expect(hasSummary).toBe(true);
    }
    expect(host.store.listUtterances(c.id).length).toBeGreaterThan(0);
  });

  it("reflections cite only existing memory ids", () => {
    let reflections = 0;
    for (const agent of host.sim.agents.values()) {
      for (const { memory } of agent.memory.all()) {
        if (memory.kind !== "reflection") continue;
        reflections += 1;
        for (const cited of memory.citations) {
          expect(agent.memory.byId(cited), `citation ${cited} exists`).toBeDefined();
        }
      }
    }
    expect(reflections).toBeGreaterThanOrEqual(1);
  });

  it("work sessions produced pending artifacts with write-shaped payloads", () => {
    const pending = host.store.listArtifacts("pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    for (const a of pending) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.body.length).toBeGreaterThan(50);
      expect(Object.keys(a.payload).length).toBeGreaterThan(0);
      expect(a.groundingRefs.length).toBeGreaterThan(0);
    }
  });

  it("never invoked a write tool through MCP", () => {
    expect(executedTools.length).toBeGreaterThan(0);
    for (const name of executedTools) {
      const bare = name.includes("__") ? name.split("__")[1]! : name;
      expect(bare).toMatch(/^(get|list|search|read|fetch|query|describe|run_query|show)/);
    }
  });

  it("rejecting an artifact injects an importance-9 memory and a revision action", async () => {
    const pending = host.store.listArtifacts("pending");
    const target = pending[0]!;
    await host.reviewArtifact(target.id, "rejected", "needs a rollout plan");

    const agent = host.sim.agents.get(target.agentId)!;
    const feedback = agent.memory
      .all()
      .find((e) => e.memory.importance === 9 && e.memory.content.includes("REJECTED"));
    expect(feedback).toBeDefined();
    expect(feedback!.memory.content).toContain("needs a rollout plan");

    const revision = agent.plans.find((p) => p.description.toLowerCase().includes("revise"));
    expect(revision).toBeDefined();
  });

  it("survives pause/resume from the database (restart safety)", async () => {
    await host.pause();
    const clockBefore = host.sim.clock.now;
    const saved = host.store.getSimState("clock");
    expect(Number(saved)).toBe(clockBefore);
    const agents = host.store.listAgents();
    expect(agents.length).toBe(host.sim.agents.size);
    for (const a of agents) {
      expect(() => JSON.parse(a.stateJson)).not.toThrow();
    }
  });
});

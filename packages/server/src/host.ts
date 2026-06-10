import { EventEmitter } from "node:events";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  AgentRuntime,
  MemoryStream,
  Simulation,
  WorldTree,
  loadWorld,
  parseSoul,
  type EmbedderPort,
  type FriendlyWorld,
  type LlmPort,
} from "@virtual-sim/core";
import {
  simSettingsSchema,
  type Artifact,
  type SimSettings,
  type SimStatus,
  type StateSnapshot,
} from "@virtual-sim/shared";
import { SqliteStore } from "./db/store.js";
import { SCHEMA } from "./db/schema.js";
import { BudgetManager, BudgetExhaustedError } from "./llm/budget.js";
import { AnthropicLlm } from "./llm/client.js";
import { MockLlm } from "./llm/mock.js";
import { LocalEmbedder } from "./embeddings/local.js";
import { McpManager } from "./mcp/manager.js";

export interface HostOptions {
  dbPath: string;
  soulsDir: string;
  worldPath: string;
  fixturesDir: string;
}

/**
 * SimHost: owns the store, LLM, MCP manager, and the Simulation; drives the
 * tick interval and exposes the command surface used by the WS/REST API and
 * the CLI. Events for the UI are re-emitted on `events`.
 */
export class SimHost {
  readonly events = new EventEmitter();
  store!: SqliteStore;
  sim!: Simulation;
  budget!: BudgetManager;
  mcp!: McpManager;
  llm!: LlmPort;
  embedder!: EmbedderPort;
  settings!: SimSettings;
  llmMode: "live" | "mock" = "mock";
  private interval: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly opts: HostOptions) {}

  async init(): Promise<void> {
    this.store = new SqliteStore(this.opts.dbPath, SCHEMA);

    const saved = this.store.getSetting("sim");
    this.settings = simSettingsSchema.parse(saved ? JSON.parse(saved) : {});

    this.budget = new BudgetManager(this.store, this.settings.dailyTokenBudget, (state) =>
      this.events.emit("event", { type: "budget.update", payload: state }),
    );

    if (process.env.ANTHROPIC_API_KEY) {
      this.llm = new AnthropicLlm(
        {
          cognitionModel: this.settings.cognitionModel,
          utilityModel: this.settings.utilityModel,
          adaptiveThinking: this.settings.adaptiveThinking,
        },
        this.budget,
      );
      this.llmMode = "live";
    } else {
      console.warn("[llm] no ANTHROPIC_API_KEY — running with the deterministic MockLlm");
      this.llm = new MockLlm();
      this.llmMode = "mock";
    }

    this.embedder = new LocalEmbedder();

    this.mcp = new McpManager(this.opts.fixturesDir, (servers) =>
      this.events.emit("event", { type: "mcp.status", payload: { servers } }),
    );
    await this.mcp.configure(this.settings);

    const world = loadWorld(JSON.parse(readFileSync(this.opts.worldPath, "utf8")) as FriendlyWorld);
    const savedClock = this.store.getSimState("clock");
    const startSim = savedClock ? Number(savedClock) : 7 * 60 + 55;

    this.sim = new Simulation(
      {
        llm: this.guardedLlm(),
        store: this.store,
        tools: this.mcp,
        sink: { emit: (e) => this.events.emit("event", e) },
      },
      this.settings,
      new WorldTree(world),
      startSim,
    );

    this.loadAgents(world);
  }

  /** Wrap the LLM so budget-blocked calls degrade to skips instead of crashes. */
  private guardedLlm(): LlmPort {
    const inner = this.llm;
    return {
      call: async (req) => {
        try {
          return await inner.call(req);
        } catch (err) {
          if (err instanceof BudgetExhaustedError) throw err;
          // One retry for transient failures, then rethrow.
          await new Promise((r) => setTimeout(r, 1500));
          return inner.call(req);
        }
      },
      toolLoop: (req) => inner.toolLoop(req),
    };
  }

  private loadAgents(world: ReturnType<typeof loadWorld>): void {
    const savedAgents = new Map(this.store.listAgents().map((a) => [a.soulPath, a]));
    const files = readdirSync(this.opts.soulsDir).filter((f) => f.endsWith(".soul.md"));

    for (const file of files) {
      const raw = readFileSync(join(this.opts.soulsDir, file), "utf8");
      let soul;
      try {
        soul = parseSoul(file, raw);
      } catch (err) {
        console.warn(`[souls] skipping ${file}: ${(err as Error).message}`);
        continue;
      }
      const saved = savedAgents.get(file);
      const id = saved?.id ?? `agent_${basename(file, ".soul.md")}`;
      const deskAnchor = world.anchors[soul.desk] ?? { x: 2, y: 2 };
      const startArea = soul.desk.split(".").slice(0, 2).join(".");

      const memory = new MemoryStream(id, this.store, this.embedder);
      memory.load(this.store.loadMemories(id));

      const agent = new AgentRuntime(id, soul, memory, startArea, deskAnchor);
      if (saved) {
        try {
          agent.state = { ...agent.state, ...JSON.parse(saved.stateJson) };
        } catch {
          /* fresh state */
        }
        // Restore today's plans so a restart resumes mid-day.
        const today = Math.floor(this.sim.clock.now / (24 * 60));
        agent.plans = this.store.loadPlans(id, today);
        if (agent.plans.some((p) => p.level === "day")) agent.plannedDay = today;
      }
      this.store.upsertAgent({
        id,
        name: soul.name,
        soulPath: file,
        summary: agent.summaryDescription,
        stateJson: JSON.stringify(agent.state),
      });
      this.sim.addAgent(agent);
    }
  }

  // ----------------------------------------------------------- run control

  get running(): boolean {
    return this.interval !== null;
  }

  status(): SimStatus {
    return {
      state: this.running ? "running" : "paused",
      speed: this.settings.speed,
      simTime: this.sim.clock.now,
    };
  }

  start(): void {
    if (this.interval) return;
    const ms = Math.max(20, Math.round(1000 / this.settings.speed));
    this.interval = setInterval(() => void this.safeTick(), ms);
    this.emitStatus();
  }

  async pause(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    await this.sim.quiesce();
    this.persistClock();
    this.emitStatus();
  }

  setSpeed(speed: number): void {
    this.settings.speed = Math.max(1, Math.min(600, speed));
    this.store.setSetting("sim", JSON.stringify(this.settings));
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.start();
    } else {
      this.emitStatus();
    }
  }

  private async safeTick(): Promise<void> {
    if (this.ticking) return; // never overlap ticks
    this.ticking = true;
    try {
      await this.sim.tick();
      this.persistClock();
    } catch (err) {
      console.error("[tick]", err);
    } finally {
      this.ticking = false;
    }
  }

  /** Advance N sim-minutes as fast as possible (CLI / tests). */
  async runFor(simMinutes: number): Promise<void> {
    for (let i = 0; i < simMinutes; i++) {
      await this.sim.tick();
      // Let scheduled cognition land between ticks.
      if (i % 5 === 4) await this.sim.quiesce();
    }
    await this.sim.quiesce();
    this.persistClock();
  }

  private persistClock(): void {
    this.store.setSimState("clock", String(this.sim.clock.now));
  }

  private emitStatus(): void {
    this.events.emit("event", { type: "sim.status", payload: this.status() });
  }

  // ------------------------------------------------------------- commands

  updateSettings(patch: Partial<SimSettings>): SimSettings {
    this.settings = simSettingsSchema.parse({ ...this.settings, ...patch });
    this.store.setSetting("sim", JSON.stringify(this.settings));
    this.sim.applySettings(this.settings);
    this.budget.setBudget(this.settings.dailyTokenBudget);
    if (this.llm instanceof AnthropicLlm) {
      this.llm.setModels({
        cognitionModel: this.settings.cognitionModel,
        utilityModel: this.settings.utilityModel,
        adaptiveThinking: this.settings.adaptiveThinking,
      });
    }
    this.events.emit("event", { type: "settings.updated", payload: this.settings });
    return this.settings;
  }

  async reviewArtifact(id: string, decision: "accepted" | "rejected", reason: string): Promise<Artifact | null> {
    const artifact = this.store.reviewArtifact(id, decision, reason);
    if (!artifact) return null;
    this.events.emit("event", { type: "artifact.reviewed", payload: { artifact } });
    const verb = decision === "accepted" ? "ACCEPTED" : "REJECTED";
    const feedback = `The human reviewer ${verb} my proposal "${artifact.title}"${reason ? ` — reason: ${reason}` : ""}`;
    const reaction =
      decision === "accepted"
        ? `follow up on the accepted proposal "${artifact.title}" and line up next steps`
        : `revise the proposal "${artifact.title}" to address the reviewer's feedback: ${reason}`;
    await this.sim.injectReviewerFeedback(artifact.agentId, feedback, reaction);
    return artifact;
  }

  saveSoul(fileName: string, content: string): void {
    if (!/^[a-z0-9-]+\.soul\.md$/.test(fileName)) {
      throw new Error("soul file name must match <name>.soul.md");
    }
    parseSoul(fileName, content); // validate before write
    writeFileSync(join(this.opts.soulsDir, fileName), content);
    const agent = [...this.sim.agents.values()].find((a) => a.soul.path === fileName);
    if (agent) {
      agent.reloadSoul(parseSoul(fileName, content));
      this.store.saveAgentSummary(agent.id, agent.summaryDescription);
      this.events.emit("event", {
        type: "agents.changed",
        payload: { agents: [...this.sim.agents.values()].map((a) => a.toPublic()) },
      });
    }
  }

  removeAgent(agentId: string): void {
    this.sim.removeAgent(agentId);
    this.store.deleteAgent(agentId);
    this.events.emit("event", {
      type: "agents.changed",
      payload: { agents: [...this.sim.agents.values()].map((a) => a.toPublic()) },
    });
  }

  snapshot(): StateSnapshot {
    return {
      agents: [...this.sim.agents.values()].map((a) => a.toPublic()),
      world: this.sim.world.def,
      sim: this.status(),
      settings: this.settings,
      pendingArtifacts: this.store.listArtifacts("pending"),
      recentEvents: this.store.recentWorldEvents(100),
      activeConversations: [],
      mcp: this.mcp.statusList(),
      budget: this.budget.state(),
    };
  }
}

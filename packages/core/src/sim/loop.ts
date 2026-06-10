import {
  MINUTES_PER_DAY,
  toSimDateTime,
  type Artifact,
  type PlanItem,
  type SimMinutes,
  type SimSettings,
  type WorldEvent,
} from "@virtual-sim/shared";
import type { EventSink, LlmPort, StorePort, ToolPort } from "../ports.js";
import { newId } from "../ports.js";
import { GameClock } from "./clock.js";
import { PRIORITY, Scheduler } from "./scheduler.js";
import { WorldTree } from "../world/tree.js";
import { findPath } from "../world/nav.js";
import { AgentRuntime } from "../agent/agent.js";
import { ImportanceScorer } from "../agent/importance.js";
import { generateDayPlan, decomposeWindow, replanFrom } from "../agent/plan.js";
import { reflect } from "../agent/reflect.js";
import { decideReaction } from "../agent/react.js";
import { DialogueController } from "../agent/dialogue.js";
import { resolveLocation } from "../agent/locate.js";
import { runWorkSession } from "../agent/work.js";
import type { RetrievalParams } from "../agent/retrieval.js";

const TILES_PER_TICK = 3;

export interface SimDeps {
  llm: LlmPort;
  store: StorePort;
  tools: ToolPort;
  sink: EventSink;
}

/**
 * The simulation: owns the clock, world, agents, scheduler, and active
 * conversations. The server drives it by calling tick() on a wall-clock
 * interval; cognition runs async through the scheduler so the world never
 * blocks on an LLM call.
 */
export class Simulation {
  readonly clock: GameClock;
  readonly world: WorldTree;
  readonly scheduler: Scheduler;
  readonly importance: ImportanceScorer;
  readonly agents = new Map<string, AgentRuntime>();
  private dialogues = new Map<string, DialogueController>();
  private pendingStart = new Map<string, PlanItem>();
  private tickEvents: WorldEvent[] = [];
  private observationsInFlight = 0;

  constructor(
    private readonly deps: SimDeps,
    public settings: SimSettings,
    world: WorldTree | ConstructorParameters<typeof WorldTree>[0],
    startSim: SimMinutes = 7 * 60 + 55,
  ) {
    this.clock = new GameClock(startSim);
    this.world = world instanceof WorldTree ? world : new WorldTree(world);
    this.scheduler = new Scheduler(settings.llmConcurrency);
    this.importance = new ImportanceScorer(deps.llm);
  }

  /** Wait until all in-flight cognition, scoring, and perception settles. */
  async quiesce(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      await this.importance.flush();
      await this.scheduler.drain();
      if (!this.importance.busy && this.scheduler.pending === 0 && this.observationsInFlight === 0) {
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  get retrievalParams(): RetrievalParams {
    return {
      topK: this.settings.retrievalTopK,
      weights: this.settings.retrievalWeights,
      decay: this.settings.recencyDecay,
    };
  }

  applySettings(s: SimSettings): void {
    this.settings = s;
    this.scheduler.setConcurrency(s.llmConcurrency);
  }

  addAgent(agent: AgentRuntime): void {
    this.agents.set(agent.id, agent);
  }

  removeAgent(agentId: string): void {
    const a = this.agents.get(agentId);
    if (!a) return;
    if (a.state.conversationId) {
      const d = this.dialogues.get(a.state.conversationId);
      if (d) void d.end(this.clock.now);
      this.dialogues.delete(a.state.conversationId);
    }
    this.agents.delete(agentId);
  }

  // ------------------------------------------------------------------ tick

  async tick(): Promise<void> {
    const now = this.clock.tick();
    this.deps.sink.emit({ type: "clock.update", payload: { simTime: now } });

    for (const agent of this.agents.values()) {
      this.stepWakeSleep(agent, now);
      if (agent.state.status === "asleep") continue;
      this.maybePlanDay(agent, now);
      this.stepMovement(agent, now);
      this.stepActions(agent, now);
      this.maybeDecompose(agent, now);
      this.maybeReflect(agent, now);
    }

    this.stepDialogues(now);
    this.perceive(now);
    await this.importance.flush();
  }

  // ----------------------------------------------------- per-agent steps

  private stepWakeSleep(agent: AgentRuntime, now: SimMinutes): void {
    const awake = agent.isAwake(now);
    if (agent.state.status === "asleep" && awake) {
      this.setStatus(agent, "idle", "☀️", null);
      this.worldEvent(now, agent.state.location, agent.name, "arrived at", "the office",
        `${agent.name} arrived at the office`);
    } else if (agent.state.status !== "asleep" && !awake) {
      if (agent.state.conversationId) {
        const d = this.dialogues.get(agent.state.conversationId);
        if (d) void this.finishDialogue(d, now);
      }
      agent.state.currentAction = null;
      agent.state.currentActionId = null;
      this.setStatus(agent, "asleep", "😴", "done for the day");
      this.persistAgent(agent);
    }
  }

  private maybePlanDay(agent: AgentRuntime, now: SimMinutes): void {
    const today = Math.floor(now / MINUTES_PER_DAY);
    if (agent.plannedDay >= today) return;
    void this.scheduler.schedule(
      PRIORITY.plan,
      async () => {
        const yesterday = agent.plans.filter((p) => p.level === "day").map((p) => p.description);
        agent.yesterdaySummary = yesterday.length > 0 ? yesterday.join("; ") : agent.yesterdaySummary;
        agent.plans = [];
        agent.decomposedUntil.clear();
        agent.workSessionsDone.clear();
        const items = await generateDayPlan(this.planDeps(agent), {
          agentId: agent.id,
          now,
          wakeHour: agent.soul.wakeHour,
          sleepHour: agent.soul.sleepHour,
          yesterdaySummary: agent.yesterdaySummary,
        });
        agent.plans.push(...items);
        agent.plannedDay = today;
        this.emitPlan(agent);
      },
      `plan:${agent.id}:${today}`,
    );
  }

  private stepMovement(agent: AgentRuntime, now: SimMinutes): void {
    if (agent.movePath.length === 0) return;
    const steps = Math.min(TILES_PER_TICK, agent.movePath.length);
    let last = { x: agent.state.x, y: agent.state.y };
    for (let i = 0; i < steps; i++) last = agent.movePath.shift()!;
    agent.state.x = last.x;
    agent.state.y = last.y;

    if (agent.movePath.length === 0 && agent.moveTargetLocation) {
      const from = agent.state.location;
      agent.state.location = agent.moveTargetLocation;
      agent.moveTargetLocation = null;
      this.deps.sink.emit({
        type: "agent.moved",
        payload: { agentId: agent.id, from, to: agent.state.location, x: last.x, y: last.y, path: [] },
      });
      const pending = this.pendingStart.get(agent.id);
      if (pending) {
        this.pendingStart.delete(agent.id);
        this.beginAction(agent, pending, now);
      } else {
        this.setStatus(agent, "idle", "🙂", null);
      }
      this.persistAgent(agent);
    }
  }

  private stepActions(agent: AgentRuntime, now: SimMinutes): void {
    // Complete actions whose window elapsed.
    for (const p of agent.plans) {
      if (p.level === "action" && p.status === "active" && p.startSim + p.durationMin <= now) {
        p.status = "done";
        this.deps.store.updatePlanStatus(p.id, "done");
        if (agent.state.currentActionId === p.id) {
          agent.state.currentAction = null;
          agent.state.currentActionId = null;
          if (agent.state.status === "acting" || agent.state.status === "working") {
            this.setStatus(agent, "idle", "🙂", null);
          }
        }
      }
    }

    if (agent.state.conversationId || agent.state.status === "moving") return;

    const due = agent.dueAction(now);
    if (!due || agent.state.currentActionId === due.id || this.pendingStart.has(agent.id)) return;

    // Start the due action: resolve location (may need an LLM call), walk, begin.
    this.setStatus(agent, "thinking", "💭", due.description);
    void this.scheduler.schedule(
      PRIORITY.plan,
      async () => {
        const area = await resolveLocation(
          { llm: this.deps.llm, system: agent.system, world: this.world },
          {
            currentArea: agent.state.location,
            action: due.description,
            locationHint: due.locationPath,
          },
        );
        due.locationPath = area;
        if (area !== agent.state.location) {
          const target = this.world.anchorOf(area);
          agent.movePath = findPath(this.world.def.tilemap.grid, { x: agent.state.x, y: agent.state.y }, target);
          agent.moveTargetLocation = area;
          this.pendingStart.set(agent.id, due);
          this.setStatus(agent, "moving", "🚶", `heading to ${this.world.get(area)?.name ?? area}`);
          this.deps.sink.emit({
            type: "agent.moved",
            payload: {
              agentId: agent.id,
              from: agent.state.location,
              to: area,
              x: agent.state.x,
              y: agent.state.y,
              path: agent.movePath,
            },
          });
        } else {
          this.beginAction(agent, due, this.clock.now);
        }
      },
      `start:${agent.id}:${due.id}`,
    );
  }

  private beginAction(agent: AgentRuntime, item: PlanItem, now: SimMinutes): void {
    item.status = "active";
    this.deps.store.updatePlanStatus(item.id, "active");
    agent.state.currentAction = item.description;
    agent.state.currentActionId = item.id;
    this.setStatus(agent, item.isWork ? "working" : "acting", item.isWork ? "💻" : "⚙️", item.description);
    this.deps.sink.emit({
      type: "agent.action",
      payload: {
        agentId: agent.id,
        description: item.description,
        location: agent.state.location,
        durationMin: item.durationMin,
      },
    });
    this.worldEvent(now, agent.state.location, agent.name, "is", item.description,
      `${agent.name} is ${item.description}`);
    this.persistAgent(agent);

    // One work session per plan chunk: the first work-typed action of a
    // chunk runs the MCP work loop; sibling actions are its in-fiction time.
    const workKey = item.parentId ?? item.id;
    if (item.isWork && !agent.workSessionsDone.has(workKey)) {
      agent.workSessionsDone.add(workKey);
      void this.scheduler.schedule(
        PRIORITY.work,
        async () => {
          const { artifact } = await runWorkSession(
            {
              llm: this.deps.llm,
              tools: this.deps.tools,
              store: this.deps.store,
              memory: agent.memory,
              system: agent.system,
              retrievalParams: this.retrievalParams,
              role: agent.soul.role,
              onArtifact: (a: Artifact) =>
                this.deps.sink.emit({ type: "artifact.created", payload: { artifact: a } }),
            },
            { agentId: agent.id, now: this.clock.now, action: item.description },
          );
          if (artifact) {
            this.worldEvent(
              this.clock.now,
              agent.state.location,
              agent.name,
              "submitted for review",
              artifact.title,
              `${agent.name} submitted "${artifact.title}" to the review queue`,
            );
          }
        },
        `work:${agent.id}:${item.id}`,
      );
    }
  }

  private maybeDecompose(agent: AgentRuntime, now: SimMinutes): void {
    const chunk = agent.activeChunk(now);
    if (!chunk) return;
    const decomposedUntil = agent.decomposedUntil.get(chunk.id) ?? chunk.startSim;
    if (decomposedUntil > now) return;
    const from = Math.max(decomposedUntil, now);
    agent.decomposedUntil.set(chunk.id, Math.min(from + 60, chunk.startSim + chunk.durationMin));
    void this.scheduler.schedule(
      PRIORITY.plan,
      async () => {
        const items = await decomposeWindow(this.planDeps(agent), chunk, from);
        agent.plans.push(...items);
        this.emitPlan(agent);
      },
      `decompose:${agent.id}:${chunk.id}:${from}`,
    );
  }

  private maybeReflect(agent: AgentRuntime, now: SimMinutes): void {
    if (agent.memory.importanceSinceReflection < this.settings.reflectionThreshold) return;
    void this.scheduler.schedule(
      PRIORITY.reflect,
      async () => {
        const created = await reflect(
          {
            llm: this.deps.llm,
            memory: agent.memory,
            system: agent.system,
            retrievalParams: this.retrievalParams,
          },
          this.clock.now,
        );
        for (const memory of created) {
          this.deps.sink.emit({ type: "reflection.created", payload: { agentId: agent.id, memory } });
        }
      },
      `reflect:${agent.id}`,
    );
  }

  // ------------------------------------------------------------- dialogue

  private stepDialogues(now: SimMinutes): void {
    for (const [id, d] of this.dialogues) {
      if (d.ended) {
        this.dialogues.delete(id);
        continue;
      }
      if (now - d.conversation.startedSim > this.settings.dialogueMaxSimMinutes) {
        void this.finishDialogue(d, now);
        continue;
      }
      // One utterance every other tick keeps conversations readable.
      if ((now - d.conversation.startedSim) % 2 !== 0) continue;
      void this.scheduler.schedule(
        PRIORITY.dialogue,
        async () => {
          const speakerName = d.currentSpeaker.name;
          const u = await d.step(this.clock.now);
          if (u) {
            this.deps.sink.emit({
              type: "dialogue.utterance",
              payload: { utterance: u, agentName: speakerName },
            });
          }
          if (d.ended) await this.finishDialogue(d, this.clock.now);
        },
        `dialogue:${id}`,
      );
    }
  }

  private async finishDialogue(d: DialogueController, now: SimMinutes): Promise<void> {
    const summary = await d.end(now);
    this.dialogues.delete(d.conversation.id);
    this.deps.sink.emit({
      type: "dialogue.ended",
      payload: { conversationId: d.conversation.id, summary },
    });
    for (const pid of d.conversation.participants) {
      const agent = this.agents.get(pid);
      if (agent && agent.state.conversationId === d.conversation.id) {
        agent.state.conversationId = null;
        this.setStatus(agent, "idle", "🙂", null);
        this.persistAgent(agent);
      }
    }
  }

  startDialogue(a: AgentRuntime, b: AgentRuntime, now: SimMinutes, openingLine: string | null): void {
    if (a.state.conversationId || b.state.conversationId) return;
    const d = new DialogueController(
      {
        llm: this.deps.llm,
        store: this.deps.store,
        retrievalParams: this.retrievalParams,
        maxTurns: this.settings.dialogueMaxTurns,
      },
      { agentId: a.id, name: a.name, system: a.system, memory: a.memory },
      { agentId: b.id, name: b.name, system: b.system, memory: b.memory },
      now,
      a.state.location,
      openingLine,
    );
    this.dialogues.set(d.conversation.id, d);
    a.state.conversationId = d.conversation.id;
    b.state.conversationId = d.conversation.id;
    this.setStatus(a, "talking", "💬", `talking with ${b.name}`);
    this.setStatus(b, "talking", "💬", `talking with ${a.name}`);
    this.deps.sink.emit({ type: "dialogue.started", payload: { conversation: d.conversation } });
    for (const u of d.utterances) {
      this.deps.sink.emit({ type: "dialogue.utterance", payload: { utterance: u, agentName: a.name } });
    }
    this.worldEvent(now, a.state.location, a.name, "started talking with", b.name,
      `${a.name} started a conversation with ${b.name}`);
  }

  // ------------------------------------------------------------ perception

  private perceive(now: SimMinutes): void {
    if (this.tickEvents.length === 0) return;
    // Consume the buffer here (not at tick start): events emitted by async
    // cognition between ticks must survive until the next perception pass.
    const events = this.tickEvents;
    this.tickEvents = [];
    for (const agent of this.agents.values()) {
      if (agent.state.status === "asleep") continue;
      for (const e of events) {
        if (e.subject === agent.name) continue;
        if (this.world.areaOf(e.locationPath) !== this.world.areaOf(agent.state.location)) continue;
        if (!agent.seen.novel(e, now)) continue;
        // Runs outside the scheduler: the score promise resolves via the
        // per-tick importance flush, so it must not hold a scheduler slot.
        this.observationsInFlight += 1;
        void this.processObservation(agent, e).finally(() => {
          this.observationsInFlight -= 1;
        });
      }
    }
  }

  private async processObservation(agent: AgentRuntime, e: WorldEvent): Promise<void> {
    try {
      const score = await this.importance.score(e.description);
      const memory = await agent.memory.append("observation", e.description, score, this.clock.now);
      this.deps.sink.emit({ type: "memory.created", payload: { agentId: agent.id, memory } });
      if (score >= this.settings.reactGateImportance && !agent.state.conversationId) {
        void this.scheduler.schedule(
          PRIORITY.react,
          () => this.handleReaction(agent, e, score),
          `react:${agent.id}`,
        );
      }
    } catch (err) {
      // Perception must never crash the tick loop.
      void err;
    }
  }

  private async handleReaction(agent: AgentRuntime, e: WorldEvent, _score: number): Promise<void> {
    const decision = await decideReaction(
      {
        llm: this.deps.llm,
        memory: agent.memory,
        system: agent.system,
        retrievalParams: this.retrievalParams,
      },
      {
        now: this.clock.now,
        currentAction: agent.state.currentAction,
        observation: e.description,
        relationshipSummary: null,
      },
    );
    if (decision.decision === "react" && decision.reaction) {
      this.applyReaction(agent, decision.reaction);
    } else if (decision.decision === "initiate_dialogue") {
      const other = [...this.agents.values()].find((x) => x.name === e.subject);
      if (
        other &&
        !other.state.conversationId &&
        other.state.status !== "asleep" &&
        this.world.areaOf(other.state.location) === this.world.areaOf(agent.state.location)
      ) {
        this.startDialogue(agent, other, this.clock.now, decision.openingLine);
      }
    }
  }

  /** Abandon the rest of the plan from now and do `reaction` instead. */
  applyReaction(agent: AgentRuntime, reaction: string, durationMin = 15): void {
    const { kept } = replanFrom({ store: this.deps.store }, agent.plans, {
      agentId: agent.id,
      simTime: this.clock.now,
      reaction,
      durationMin,
    });
    agent.plans = kept;
    agent.state.currentAction = null;
    agent.state.currentActionId = null;
    this.emitPlan(agent);
  }

  /** Reviewer feedback: high-importance memory + immediate reaction. */
  async injectReviewerFeedback(agentId: string, text: string, reaction: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const memory = await agent.memory.append("observation", text, 9, this.clock.now);
    this.deps.sink.emit({ type: "memory.created", payload: { agentId, memory } });
    this.worldEvent(this.clock.now, agent.state.location, "the human reviewer", "reviewed work by", agent.name, text);
    if (agent.state.status !== "asleep") this.applyReaction(agent, reaction, 30);
  }

  // ---------------------------------------------------------------- utils

  private planDeps(agent: AgentRuntime) {
    return {
      llm: this.deps.llm,
      store: this.deps.store,
      memory: agent.memory,
      system: agent.system,
      retrievalParams: this.retrievalParams,
      areaNames: this.world
        .paths()
        .filter((p) => this.world.get(p)!.kind === "area" && p !== this.world.def.tree.path)
        .map((p) => this.world.get(p)!.name),
    };
  }

  private emitPlan(agent: AgentRuntime): void {
    this.deps.sink.emit({
      type: "plan.updated",
      payload: { agentId: agent.id, items: [...agent.plans] },
    });
  }

  private setStatus(agent: AgentRuntime, status: AgentRuntime["state"]["status"], emoji: string, label: string | null): void {
    agent.state.status = status;
    agent.state.statusEmoji = emoji;
    this.deps.sink.emit({
      type: "agent.status",
      payload: { agentId: agent.id, status, emoji, label },
    });
  }

  private worldEvent(
    simTime: SimMinutes,
    locationPath: string,
    subject: string,
    predicate: string,
    object: string,
    description: string,
  ): void {
    const e: WorldEvent = {
      id: newId("evt"),
      simTime,
      locationPath,
      subject,
      predicate,
      object,
      description,
    };
    this.tickEvents.push(e);
    this.deps.store.insertWorldEvent(e);
    this.deps.sink.emit({ type: "world.event", payload: { event: e } });
  }

  private persistAgent(agent: AgentRuntime): void {
    this.deps.store.saveAgentState(agent.id, JSON.stringify(agent.state));
  }

  /** Debug/trace helper: human-readable line for the current sim time. */
  traceLine(): string {
    const { day, hour, minute } = toSimDateTime(this.clock.now);
    const agents = [...this.agents.values()]
      .map((a) => `${a.name}@${a.state.location.split(".").pop()}[${a.state.status}]`)
      .join(" ");
    return `D${day} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${agents}`;
  }
}

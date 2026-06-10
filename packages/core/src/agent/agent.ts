import type {
  AgentPublic,
  AgentState,
  PlanItem,
  SimMinutes,
  Soul,
} from "@virtual-sim/shared";
import type { LlmSystemBlock } from "../ports.js";
import type { MemoryStream } from "./memory.js";
import { compileSummaryDescription } from "./soul.js";
import { systemBlocks } from "./prompts.js";
import { SeenCache } from "../world/perception.js";
import type { Point } from "../world/nav.js";

/** Mutable runtime container for one agent. Cognition lives in the modules. */
export class AgentRuntime {
  readonly id: string;
  soul: Soul;
  summaryDescription: string;
  system: LlmSystemBlock[];
  readonly memory: MemoryStream;
  state: AgentState;
  /** All plan items for the current sim day (chunks + actions). */
  plans: PlanItem[] = [];
  /** Day index for which the day plan was generated (-1 = none). */
  plannedDay = -1;
  /** Day-chunk windows (chunk.id -> next undecomposed window start). */
  decomposedUntil = new Map<string, SimMinutes>();
  /** Chunks whose work session already ran (one artifact attempt per chunk). */
  workSessionsDone = new Set<string>();
  seen = new SeenCache();
  /** Tile path the agent is walking; consumed by the movement step. */
  movePath: Point[] = [];
  moveTargetLocation: string | null = null;
  yesterdaySummary: string | null = null;

  constructor(id: string, soul: Soul, memory: MemoryStream, startLocation: string, tile: Point) {
    this.id = id;
    this.soul = soul;
    this.summaryDescription = compileSummaryDescription(soul);
    this.system = systemBlocks(this.summaryDescription);
    this.memory = memory;
    this.state = {
      location: startLocation,
      status: "asleep",
      statusEmoji: "😴",
      currentAction: null,
      currentActionId: null,
      conversationId: null,
      x: tile.x,
      y: tile.y,
    };
  }

  reloadSoul(soul: Soul): void {
    this.soul = soul;
    this.summaryDescription = compileSummaryDescription(soul);
    this.system = systemBlocks(this.summaryDescription);
  }

  setSummary(summary: string): void {
    this.summaryDescription = summary;
    this.system = systemBlocks(summary);
  }

  get name(): string {
    return this.soul.name;
  }

  isAwake(now: SimMinutes): boolean {
    const hour = Math.floor((now % (24 * 60)) / 60);
    return hour >= this.soul.wakeHour && hour < this.soul.sleepHour;
  }

  /** Currently-due action item, if any. */
  dueAction(now: SimMinutes): PlanItem | undefined {
    return this.plans.find(
      (p) =>
        p.level === "action" &&
        p.status !== "done" &&
        p.status !== "abandoned" &&
        p.startSim <= now &&
        p.startSim + p.durationMin > now,
    );
  }

  /** Active day chunk for `now`. */
  activeChunk(now: SimMinutes): PlanItem | undefined {
    return this.plans.find(
      (p) => p.level === "day" && p.startSim <= now && p.startSim + p.durationMin > now,
    );
  }

  toPublic(): AgentPublic {
    return {
      id: this.id,
      name: this.soul.name,
      role: this.soul.role,
      team: this.soul.team,
      avatar: this.soul.avatar,
      color: this.soul.color,
      desk: this.soul.desk,
      wakeHour: this.soul.wakeHour,
      sleepHour: this.soul.sleepHour,
      summaryDescription: this.summaryDescription,
      state: { ...this.state },
    };
  }
}

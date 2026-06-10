import {
  actionListJsonSchema,
  actionListZ,
  dayPlanJsonSchema,
  dayPlanZ,
  formatSimTime,
  MINUTES_PER_DAY,
  type PlanItem,
  type SimMinutes,
} from "@virtual-sim/shared";
import type { LlmPort, LlmSystemBlock, StorePort } from "../ports.js";
import { newId } from "../ports.js";
import type { RetrievalParams } from "./retrieval.js";
import type { MemoryStream } from "./memory.js";
import { dayPlanPrompt, decomposePrompt } from "./prompts.js";
import { PRIORITY } from "../sim/scheduler.js";

export interface PlanDeps {
  llm: LlmPort;
  store: StorePort;
  memory: MemoryStream;
  system: LlmSystemBlock[];
  retrievalParams: RetrievalParams;
  areaNames: string[];
}

/**
 * Generate the day plan: 5-8 chunks covering the working day.
 * Chunks are stored as level="day" items; actions are decomposed lazily.
 */
export async function generateDayPlan(
  deps: PlanDeps,
  args: {
    agentId: string;
    now: SimMinutes;
    wakeHour: number;
    sleepHour: number;
    yesterdaySummary: string | null;
  },
): Promise<PlanItem[]> {
  const retrieved = await deps.memory.retrieveByQuery(
    "current goals, commitments, roadmap priorities, and unfinished work",
    args.now,
    deps.retrievalParams,
  );
  const res = await deps.llm.call({
    tier: "cognition",
    purpose: "plan.day",
    system: deps.system,
    user: dayPlanPrompt({
      now: args.now,
      wakeHour: args.wakeHour,
      sleepHour: args.sleepHour,
      yesterdaySummary: args.yesterdaySummary,
      retrieved: retrieved.map((r) => r.memory),
      areaNames: deps.areaNames,
    }),
    jsonSchema: dayPlanJsonSchema,
    maxTokens: 2000,
    priority: PRIORITY.plan,
  });
  const parsed = dayPlanZ.parse(JSON.parse(res.text));
  const simDay = Math.floor(args.now / MINUTES_PER_DAY);
  const dayStart = simDay * MINUTES_PER_DAY;

  const items: PlanItem[] = parsed.chunks
    .filter((c) => c.endHour > c.startHour)
    .map((c) => ({
      id: newId("plan"),
      agentId: args.agentId,
      simDay,
      level: "day" as const,
      parentId: null,
      description: c.summary,
      locationPath: null,
      startSim: dayStart + c.startHour * 60,
      durationMin: (c.endHour - c.startHour) * 60,
      status: "pending" as const,
      isWork: c.isWork,
    }));

  deps.store.insertPlanItems(items);
  await deps.memory.append(
    "plan",
    `Planned the day: ${parsed.chunks.map((c) => `${c.startHour}:00-${c.endHour}:00 ${c.summary}`).join("; ")}`,
    4,
    args.now,
  );
  return items;
}

/**
 * Lazily decompose the next window (up to 60 min) of a chunk into 5-15 min
 * actions, starting at `from`.
 */
export async function decomposeWindow(
  deps: PlanDeps,
  chunk: PlanItem,
  from: SimMinutes,
): Promise<PlanItem[]> {
  const chunkEnd = chunk.startSim + chunk.durationMin;
  const windowEnd = Math.min(from + 60, chunkEnd);
  const windowMin = windowEnd - from;
  if (windowMin < 5) return [];

  const res = await deps.llm.call({
    tier: "cognition",
    purpose: "plan.decompose",
    system: deps.system,
    user: decomposePrompt({
      now: from,
      chunkSummary: chunk.description,
      windowStart: formatSimTime(from),
      windowEnd: formatSimTime(windowEnd),
      areaNames: deps.areaNames,
    }),
    jsonSchema: actionListJsonSchema,
    maxTokens: 1500,
    priority: PRIORITY.plan,
  });
  const parsed = actionListZ.parse(JSON.parse(res.text));

  const items: PlanItem[] = [];
  let cursor = from;
  for (const a of parsed.actions) {
    if (cursor >= windowEnd) break;
    const duration = Math.min(a.durationMin, windowEnd - cursor);
    items.push({
      id: newId("plan"),
      agentId: chunk.agentId,
      simDay: chunk.simDay,
      level: "action",
      parentId: chunk.id,
      description: a.description,
      locationPath: a.locationHint, // resolved to a concrete path by locate.ts at start time
      startSim: cursor,
      durationMin: duration,
      status: "pending",
      isWork: chunk.isWork,
    });
    cursor += duration;
  }
  // Pad any remainder so the window is always covered.
  if (cursor < windowEnd && items.length > 0) {
    const last = items[items.length - 1]!;
    last.durationMin += windowEnd - cursor;
  }
  deps.store.insertPlanItems(items);
  return items;
}

/**
 * Abandon all pending/active items from `simTime` onward (keeping completed
 * work) and insert a reaction action; the rest of the day regenerates lazily.
 */
export function replanFrom(
  deps: Pick<PlanDeps, "store">,
  plans: PlanItem[],
  args: { agentId: string; simTime: SimMinutes; reaction: string; durationMin?: number },
): { kept: PlanItem[]; reactionItem: PlanItem } {
  const kept: PlanItem[] = [];
  for (const p of plans) {
    const ends = p.startSim + p.durationMin;
    if (p.level === "action" && ends > args.simTime && p.status !== "done") {
      p.status = "abandoned";
      deps.store.updatePlanStatus(p.id, "abandoned");
    } else {
      kept.push(p);
    }
  }
  const reactionItem: PlanItem = {
    id: newId("plan"),
    agentId: args.agentId,
    simDay: Math.floor(args.simTime / MINUTES_PER_DAY),
    level: "action",
    parentId: null,
    description: args.reaction,
    locationPath: null,
    startSim: args.simTime,
    durationMin: args.durationMin ?? 15,
    status: "pending",
    isWork: false,
  };
  deps.store.insertPlanItems([reactionItem]);
  kept.push(reactionItem);
  return { kept, reactionItem };
}

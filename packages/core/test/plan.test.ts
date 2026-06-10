import { describe, expect, it } from "vitest";
import { replanFrom } from "../src/agent/plan.js";
import type { PlanItem } from "@virtual-sim/shared";

function action(id: string, startSim: number, durationMin: number, status: PlanItem["status"] = "pending"): PlanItem {
  return {
    id,
    agentId: "a",
    simDay: 0,
    level: "action",
    parentId: null,
    description: id,
    locationPath: null,
    startSim,
    durationMin,
    status,
    isWork: false,
  };
}

function makeStore() {
  const updates: Array<[string, string]> = [];
  const inserted: PlanItem[][] = [];
  return {
    store: {
      updatePlanStatus: (id: string, status: PlanItem["status"]) => void updates.push([id, status]),
      insertPlanItems: (items: PlanItem[]) => void inserted.push(items),
    } as never,
    updates,
    inserted,
  };
}

describe("replanFrom", () => {
  it("abandons future actions, keeps completed ones, inserts the reaction", () => {
    const { store, updates } = makeStore();
    const plans = [
      action("done-early", 0, 10, "done"),
      action("in-progress", 10, 15, "active"), // ends at 25 > now=20 → abandoned
      action("future", 25, 10, "pending"),
    ];
    const { kept, reactionItem } = replanFrom({ store }, plans, {
      agentId: "a",
      simTime: 20,
      reaction: "deal with the incident",
    });
    const keptIds = kept.map((p) => p.id);
    expect(keptIds).toContain("done-early");
    expect(keptIds).not.toContain("in-progress");
    expect(keptIds).not.toContain("future");
    expect(keptIds).toContain(reactionItem.id);
    expect(reactionItem.startSim).toBe(20);
    expect(updates).toEqual([
      ["in-progress", "abandoned"],
      ["future", "abandoned"],
    ]);
  });

  it("keeps actions that already ended even if not marked done", () => {
    const { store } = makeStore();
    const plans = [action("ended", 0, 10, "active")];
    const { kept } = replanFrom({ store }, plans, { agentId: "a", simTime: 20, reaction: "r" });
    expect(kept.map((p) => p.id)).toContain("ended");
  });
});

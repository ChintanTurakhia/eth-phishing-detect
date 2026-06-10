"use client";

import { create } from "zustand";
import type {
  AgentPublic,
  Artifact,
  BudgetState,
  Conversation,
  McpServerStatus,
  Memory,
  PlanItem,
  SimSettings,
  SimStatus,
  StateSnapshot,
  Utterance,
  WorldDefinition,
  WorldEvent,
} from "@virtual-sim/shared";

export interface LiveUtterance extends Utterance {
  agentName: string;
}

export interface MovedEvent {
  agentId: string;
  to: string;
  x: number;
  y: number;
  path: Array<{ x: number; y: number }>;
  at: number;
}

interface SimStore {
  connected: boolean;
  view: "dashboard" | "office";
  snapshot: StateSnapshot | null;
  agents: Map<string, AgentPublic>;
  world: WorldDefinition | null;
  sim: SimStatus;
  settings: SimSettings | null;
  budget: BudgetState | null;
  mcp: McpServerStatus[];
  events: WorldEvent[];
  memories: Map<string, Memory[]>; // recent per agent (newest first, capped)
  plans: Map<string, PlanItem[]>;
  conversations: Map<string, Conversation>;
  utterances: Map<string, LiveUtterance[]>;
  artifacts: Artifact[];
  lastMoves: Map<string, MovedEvent>;
  selectedAgentId: string | null;
  showSettings: boolean;
  showReview: boolean;

  setView(view: "dashboard" | "office"): void;
  select(agentId: string | null): void;
  toggleSettings(open?: boolean): void;
  toggleReview(open?: boolean): void;
  applySnapshot(s: StateSnapshot): void;
  handleEvent(type: string, payload: unknown): void;
}

const MAX_EVENTS = 250;
const MAX_MEMORIES = 200;

export const useSim = create<SimStore>((set, get) => ({
  connected: false,
  view: "dashboard",
  snapshot: null,
  agents: new Map(),
  world: null,
  sim: { state: "paused", speed: 60, simTime: 0 },
  settings: null,
  budget: null,
  mcp: [],
  events: [],
  memories: new Map(),
  plans: new Map(),
  conversations: new Map(),
  utterances: new Map(),
  artifacts: [],
  lastMoves: new Map(),
  selectedAgentId: null,
  showSettings: false,
  showReview: false,

  setView: (view) => set({ view }),
  select: (selectedAgentId) => set({ selectedAgentId }),
  toggleSettings: (open) => set((s) => ({ showSettings: open ?? !s.showSettings })),
  toggleReview: (open) => set((s) => ({ showReview: open ?? !s.showReview })),

  applySnapshot: (s) =>
    set({
      snapshot: s,
      agents: new Map(s.agents.map((a) => [a.id, a])),
      world: s.world,
      sim: s.sim,
      settings: s.settings,
      budget: s.budget,
      mcp: s.mcp,
      events: s.recentEvents.slice(0, MAX_EVENTS),
      artifacts: s.pendingArtifacts,
      connected: true,
    }),

  handleEvent: (type, payload) => {
    const state = get();
    switch (type) {
      case "state.snapshot":
        state.applySnapshot(payload as StateSnapshot);
        break;
      case "clock.update":
        set((s) => ({ sim: { ...s.sim, simTime: (payload as { simTime: number }).simTime } }));
        break;
      case "sim.status":
        set({ sim: payload as SimStatus });
        break;
      case "agent.status": {
        const p = payload as { agentId: string; status: AgentPublic["state"]["status"]; emoji: string; label: string | null };
        set((s) => {
          const agents = new Map(s.agents);
          const a = agents.get(p.agentId);
          if (a) {
            agents.set(p.agentId, {
              ...a,
              state: { ...a.state, status: p.status, statusEmoji: p.emoji, currentAction: p.label ?? a.state.currentAction },
            });
          }
          return { agents };
        });
        break;
      }
      case "agent.moved": {
        const p = payload as MovedEvent & { from: string };
        set((s) => {
          const agents = new Map(s.agents);
          const a = agents.get(p.agentId);
          if (a) {
            agents.set(p.agentId, { ...a, state: { ...a.state, location: p.to, x: p.x, y: p.y } });
          }
          const lastMoves = new Map(s.lastMoves);
          lastMoves.set(p.agentId, { ...p, at: Date.now() });
          return { agents, lastMoves };
        });
        break;
      }
      case "agent.action": {
        const p = payload as { agentId: string; description: string };
        set((s) => {
          const agents = new Map(s.agents);
          const a = agents.get(p.agentId);
          if (a) agents.set(p.agentId, { ...a, state: { ...a.state, currentAction: p.description } });
          return { agents };
        });
        break;
      }
      case "world.event": {
        const p = payload as { event: WorldEvent };
        set((s) => ({ events: [p.event, ...s.events].slice(0, MAX_EVENTS) }));
        break;
      }
      case "memory.created":
      case "reflection.created": {
        const p = payload as { agentId: string; memory: Memory };
        set((s) => {
          const memories = new Map(s.memories);
          const list = memories.get(p.agentId) ?? [];
          memories.set(p.agentId, [p.memory, ...list].slice(0, MAX_MEMORIES));
          return { memories };
        });
        break;
      }
      case "plan.updated": {
        const p = payload as { agentId: string; items: PlanItem[] };
        set((s) => {
          const plans = new Map(s.plans);
          plans.set(p.agentId, p.items);
          return { plans };
        });
        break;
      }
      case "dialogue.started": {
        const p = payload as { conversation: Conversation };
        set((s) => {
          const conversations = new Map(s.conversations);
          conversations.set(p.conversation.id, p.conversation);
          return { conversations };
        });
        break;
      }
      case "dialogue.utterance": {
        const p = payload as { utterance: Utterance; agentName: string };
        set((s) => {
          const utterances = new Map(s.utterances);
          const list = utterances.get(p.utterance.conversationId) ?? [];
          utterances.set(p.utterance.conversationId, [...list, { ...p.utterance, agentName: p.agentName }]);
          return { utterances };
        });
        break;
      }
      case "dialogue.ended": {
        const p = payload as { conversationId: string; summary: string };
        set((s) => {
          const conversations = new Map(s.conversations);
          const c = conversations.get(p.conversationId);
          if (c) conversations.set(p.conversationId, { ...c, endedSim: s.sim.simTime, summary: p.summary });
          return { conversations };
        });
        break;
      }
      case "artifact.created": {
        const p = payload as { artifact: Artifact };
        set((s) => ({ artifacts: [p.artifact, ...s.artifacts] }));
        break;
      }
      case "artifact.reviewed": {
        const p = payload as { artifact: Artifact };
        set((s) => ({
          artifacts: s.artifacts.map((a) => (a.id === p.artifact.id ? p.artifact : a)),
        }));
        break;
      }
      case "mcp.status":
        set({ mcp: (payload as { servers: McpServerStatus[] }).servers });
        break;
      case "budget.update":
        set({ budget: payload as BudgetState });
        break;
      case "settings.updated":
        set({ settings: payload as SimSettings });
        break;
      case "agents.changed": {
        const p = payload as { agents: AgentPublic[] };
        set({ agents: new Map(p.agents.map((a) => [a.id, a])) });
        break;
      }
    }
  },
}));

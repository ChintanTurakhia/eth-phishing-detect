/**
 * WebSocket protocol: one JSON envelope both directions.
 * Server -> client: ServerEvent. Client -> server: ClientCommand.
 */
import type {
  AgentPublic,
  Artifact,
  BudgetState,
  Conversation,
  McpServerStatus,
  Memory,
  PlanItem,
  SimMinutes,
  SimStatus,
  Utterance,
  WorldDefinition,
  WorldEvent,
} from "./types.js";
import type { SimSettings } from "./settings.js";

export interface Envelope<T> {
  v: 1;
  seq: number;
  ts: { wall: number; sim: SimMinutes };
  type: string;
  payload: T;
}

// ---------- Server -> client events ----------

export interface StateSnapshot {
  agents: AgentPublic[];
  world: WorldDefinition;
  sim: SimStatus;
  settings: SimSettings;
  pendingArtifacts: Artifact[];
  recentEvents: WorldEvent[];
  activeConversations: Conversation[];
  mcp: McpServerStatus[];
  budget: BudgetState;
}

export type ServerEvent =
  | { type: "state.snapshot"; payload: StateSnapshot }
  | { type: "clock.update"; payload: { simTime: SimMinutes } }
  | { type: "sim.status"; payload: SimStatus }
  | {
      type: "agent.moved";
      payload: { agentId: string; from: string; to: string; x: number; y: number; path: Array<{ x: number; y: number }> };
    }
  | { type: "agent.status"; payload: { agentId: string; status: string; emoji: string; label: string | null } }
  | {
      type: "agent.action";
      payload: { agentId: string; description: string; location: string; durationMin: number };
    }
  | { type: "memory.created"; payload: { agentId: string; memory: Memory } }
  | { type: "reflection.created"; payload: { agentId: string; memory: Memory } }
  | { type: "plan.updated"; payload: { agentId: string; items: PlanItem[] } }
  | { type: "dialogue.started"; payload: { conversation: Conversation } }
  | { type: "dialogue.utterance"; payload: { utterance: Utterance; agentName: string } }
  | { type: "dialogue.ended"; payload: { conversationId: string; summary: string } }
  | { type: "world.event"; payload: { event: WorldEvent } }
  | { type: "artifact.created"; payload: { artifact: Artifact } }
  | { type: "artifact.reviewed"; payload: { artifact: Artifact } }
  | { type: "mcp.status"; payload: { servers: McpServerStatus[] } }
  | { type: "budget.update"; payload: BudgetState }
  | { type: "settings.updated"; payload: SimSettings }
  | { type: "agents.changed"; payload: { agents: AgentPublic[] } }
  | { type: "error"; payload: { message: string } };

export type ServerEventType = ServerEvent["type"];

// ---------- Client -> server commands ----------

export type ClientCommand =
  | { type: "sim.start"; payload?: Record<string, never> }
  | { type: "sim.pause"; payload?: Record<string, never> }
  | { type: "sim.resume"; payload?: Record<string, never> }
  | { type: "sim.setSpeed"; payload: { speed: number } }
  | { type: "settings.update"; payload: { patch: Partial<SimSettings> } }
  | { type: "artifact.review"; payload: { id: string; decision: "accepted" | "rejected"; reason: string } }
  | { type: "soul.save"; payload: { fileName: string; content: string } }
  | { type: "agent.remove"; payload: { agentId: string } };

export type ClientCommandType = ClientCommand["type"];

export function makeEnvelope<T extends { type: string; payload: unknown }>(
  seq: number,
  sim: SimMinutes,
  event: T,
): Envelope<T["payload"]> & { type: T["type"] } {
  return {
    v: 1,
    seq,
    ts: { wall: Date.now(), sim },
    type: event.type,
    payload: event.payload,
  } as Envelope<T["payload"]> & { type: T["type"] };
}

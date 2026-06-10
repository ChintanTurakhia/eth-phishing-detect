/**
 * Ports: every I/O dependency of the engine is injected through these
 * interfaces, so the core stays unit-testable without network or disk.
 */
import type {
  Artifact,
  Conversation,
  Memory,
  PlanItem,
  SimMinutes,
  Utterance,
  WorldEvent,
} from "@virtual-sim/shared";

export type LlmTier = "cognition" | "utility";

export type LlmPurpose =
  | "plan.day"
  | "plan.decompose"
  | "react"
  | "reflect.questions"
  | "reflect.insights"
  | "dialogue.turn"
  | "dialogue.summary"
  | "relationship.summary"
  | "importance"
  | "locate"
  | "work"
  | "summary.refresh";

export interface LlmSystemBlock {
  text: string;
  cache: boolean;
}

export interface LlmRequest {
  tier: LlmTier;
  purpose: LlmPurpose;
  system: LlmSystemBlock[];
  user: string;
  /** JSON Schema for output_config.format; response text will be valid JSON. */
  jsonSchema?: object;
  maxTokens?: number;
  /** Scheduler priority: lower runs first. */
  priority: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ToolLoopRequest {
  tier: LlmTier;
  purpose: LlmPurpose;
  system: LlmSystemBlock[];
  user: string;
  tools: AgentTool[];
  maxRounds: number;
  maxTokens?: number;
  priority: number;
  /** Executes one tool call and returns the result string shown to the model. */
  execute: (name: string, input: Record<string, unknown>) => Promise<string>;
}

export interface ToolLoopResult {
  finalText: string;
  toolCallsMade: Array<{ name: string; input: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmPort {
  call(req: LlmRequest): Promise<LlmResponse>;
  /** Manual agentic loop with client-side tools (used by work sessions). */
  toolLoop(req: ToolLoopRequest): Promise<ToolLoopResult>;
}

export interface EmbedderPort {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
}

/** A tool exposed to an agent's work loop (already read-only-filtered). */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ToolPort {
  listTools(role: string): AgentTool[];
  executeTool(name: string, input: Record<string, unknown>): Promise<string>;
}

export interface StorePort {
  insertMemory(m: Memory, embedding: Float32Array): void;
  touchMemories(ids: string[], lastAccessedSim: SimMinutes): void;
  loadMemories(agentId: string): Array<{ memory: Memory; embedding: Float32Array }>;
  insertPlanItems(items: PlanItem[]): void;
  updatePlanStatus(id: string, status: PlanItem["status"]): void;
  abandonPlansFrom(agentId: string, simTime: SimMinutes): void;
  loadPlans(agentId: string, simDay: number): PlanItem[];
  insertConversation(c: Conversation): void;
  endConversation(id: string, endedSim: SimMinutes, summary: string): void;
  insertUtterance(u: Utterance): void;
  insertArtifact(a: Artifact): void;
  insertWorldEvent(e: WorldEvent): void;
  saveAgentState(agentId: string, stateJson: string): void;
  saveAgentSummary(agentId: string, summary: string): void;
}

export interface EventSink {
  emit(event: { type: string; payload: unknown }): void;
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Sim time is measured in whole sim-minutes since the sim epoch (day 0, 00:00). */
export type SimMinutes = number;

export const MINUTES_PER_DAY = 24 * 60;

export interface SimDateTime {
  day: number;
  hour: number;
  minute: number;
}

export function toSimDateTime(t: SimMinutes): SimDateTime {
  const day = Math.floor(t / MINUTES_PER_DAY);
  const rem = t - day * MINUTES_PER_DAY;
  return { day, hour: Math.floor(rem / 60), minute: rem % 60 };
}

export function formatSimTime(t: SimMinutes): string {
  const { day, hour, minute } = toSimDateTime(t);
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `Day ${day} ${hh}:${mm}`;
}

export type AgentRole = "engineer" | "pm" | "designer";

export type AgentStatus =
  | "asleep"
  | "idle"
  | "moving"
  | "acting"
  | "talking"
  | "thinking"
  | "working";

export interface SoulFrontmatter {
  name: string;
  role: AgentRole;
  team: string;
  desk: string;
  avatar: string;
  color: string;
  wakeHour: number;
  sleepHour: number;
}

export interface Soul extends SoulFrontmatter {
  /** Path of the source soul file, relative to the souls dir. */
  path: string;
  identity: string;
  personality: string;
  expertise: string;
  values: string;
  quirks: string;
  relationships: string;
}

export interface AgentState {
  /** Location path in the world tree, e.g. "office.bullpen.desks-ada". */
  location: string;
  status: AgentStatus;
  statusEmoji: string;
  /** Short label of what the agent is currently doing. */
  currentAction: string | null;
  currentActionId: string | null;
  conversationId: string | null;
  /** Tile position for the office view. */
  x: number;
  y: number;
}

export interface AgentPublic {
  id: string;
  name: string;
  role: AgentRole;
  team: string;
  avatar: string;
  color: string;
  desk: string;
  wakeHour: number;
  sleepHour: number;
  summaryDescription: string;
  state: AgentState;
}

export type MemoryKind = "observation" | "reflection" | "plan" | "dialogue";

export interface Memory {
  id: string;
  agentId: string;
  kind: MemoryKind;
  content: string;
  importance: number; // 1-10
  createdAtSim: SimMinutes;
  lastAccessedSim: SimMinutes;
  /** IDs of evidence memories (reflections cite their sources). */
  citations: string[];
}

export interface RetrievalScore {
  memoryId: string;
  recency: number;
  importance: number;
  relevance: number;
  total: number;
}

export type PlanLevel = "day" | "hour" | "action";
export type PlanStatus = "pending" | "active" | "done" | "abandoned";

export interface PlanItem {
  id: string;
  agentId: string;
  simDay: number;
  level: PlanLevel;
  parentId: string | null;
  description: string;
  locationPath: string | null;
  startSim: SimMinutes;
  durationMin: number;
  status: PlanStatus;
  /** True when this item involves real work product (triggers the MCP work loop). */
  isWork: boolean;
}

export interface Conversation {
  id: string;
  participants: string[];
  startedSim: SimMinutes;
  endedSim: SimMinutes | null;
  summary: string | null;
  location: string;
}

export interface Utterance {
  id: string;
  conversationId: string;
  agentId: string;
  content: string;
  simTime: SimMinutes;
  seq: number;
}

export type ArtifactType =
  | "pr_proposal"
  | "linear_issue"
  | "idea_doc"
  | "debate_summary"
  | "review_note";

export type ArtifactStatus = "pending" | "accepted" | "rejected";

export interface Artifact {
  id: string;
  agentId: string;
  type: ArtifactType;
  title: string;
  /** Markdown body shown to the reviewer. */
  body: string;
  /** Shaped exactly as the future v2 MCP write-tool arguments. */
  payload: Record<string, unknown>;
  /** Source URIs / tool calls that grounded this artifact. */
  groundingRefs: string[];
  status: ArtifactStatus;
  reviewReason: string | null;
  createdSim: SimMinutes;
  reviewedAtWall: number | null;
}

export interface WorldEvent {
  id: string;
  simTime: SimMinutes;
  locationPath: string;
  subject: string;
  predicate: string;
  object: string;
  description: string;
}

/** Environment tree node. Leaves may be objects with a mutable state string. */
export interface WorldNode {
  /** Full dot path, e.g. "office.kitchen.coffee-machine". */
  path: string;
  name: string;
  kind: "area" | "object";
  state: string | null;
  children: WorldNode[];
}

export interface WorldAnchor {
  x: number;
  y: number;
}

export interface WorldDefinition {
  name: string;
  tilemap: {
    width: number;
    height: number;
    tileSize: number;
    /** Row-major grid; 0 = walkable floor, 1 = wall/blocked. */
    grid: number[][];
  };
  tree: WorldNode;
  anchors: Record<string, WorldAnchor>;
}

export type McpServerName = "linear" | "slack" | "github" | "glean" | "snowflake";

export interface McpServerStatus {
  name: McpServerName;
  mode: "mock" | "live";
  connected: boolean;
  toolCount: number;
  error: string | null;
}

export interface BudgetState {
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  budgetTokens: number;
  exhausted: boolean;
}

export type SimRunState = "running" | "paused";

export interface SimStatus {
  state: SimRunState;
  speed: number; // sim-minutes per wall-second
  simTime: SimMinutes;
}

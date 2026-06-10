import {
  produceArtifactJsonSchema,
  produceArtifactZ,
  type Artifact,
  type SimMinutes,
} from "@virtual-sim/shared";
import type {
  AgentTool,
  LlmPort,
  LlmSystemBlock,
  StorePort,
  ToolPort,
} from "../ports.js";
import { newId } from "../ports.js";
import type { MemoryStream } from "./memory.js";
import type { RetrievalParams } from "./retrieval.js";
import { workPrompt, workSystemSuffix } from "./prompts.js";
import { PRIORITY } from "../sim/scheduler.js";

const PRODUCE_ARTIFACT: AgentTool = {
  name: "produce_artifact",
  description:
    "Submit a reviewable work product (feature proposal, Linear issue draft, PR draft, idea doc, analysis) to the human review queue. Call at most once per work session, when the work is complete and reviewer-ready.",
  inputSchema: produceArtifactJsonSchema,
};

const NOTE_OBSERVATION: AgentTool = {
  name: "note_observation",
  description:
    "Record a key learning or finding from this work session into your own memory (e.g. 'The roadmap prioritizes export features for Q3', 'Churn is concentrated in the free tier').",
  inputSchema: {
    type: "object",
    properties: { note: { type: "string" } },
    required: ["note"],
    additionalProperties: false,
  },
};

export interface WorkDeps {
  llm: LlmPort;
  tools: ToolPort;
  store: StorePort;
  memory: MemoryStream;
  system: LlmSystemBlock[];
  retrievalParams: RetrievalParams;
  role: string;
  onArtifact: (artifact: Artifact) => void;
}

/**
 * Execute a work-typed action: bounded agentic loop over read-only MCP
 * tools plus the produce_artifact / note_observation virtual tools.
 */
export async function runWorkSession(
  deps: WorkDeps,
  args: { agentId: string; now: SimMinutes; action: string },
): Promise<{ artifact: Artifact | null; notes: string[] }> {
  const retrieved = await deps.memory.retrieveByQuery(args.action, args.now, deps.retrievalParams);
  const mcpTools = deps.tools.listTools(deps.role);
  const tools = [...mcpTools, PRODUCE_ARTIFACT, NOTE_OBSERVATION];

  let artifact: Artifact | null = null;
  const notes: string[] = [];
  const groundingCalls: string[] = [];

  const result = await deps.llm.toolLoop({
    tier: "cognition",
    purpose: "work",
    system: [...deps.system, { text: workSystemSuffix(), cache: false }],
    user: workPrompt({
      now: args.now,
      action: args.action,
      retrieved: retrieved.map((r) => r.memory),
    }),
    tools,
    maxRounds: 6,
    maxTokens: 4000,
    priority: PRIORITY.work,
    execute: async (name, input) => {
      if (name === "produce_artifact") {
        const parsed = produceArtifactZ.safeParse(input);
        if (!parsed.success) {
          return `Invalid artifact: ${parsed.error.issues.map((i) => i.message).join("; ")}. Fix the fields and call produce_artifact again.`;
        }
        if (artifact) return "An artifact was already submitted this session.";
        artifact = {
          id: newId("art"),
          agentId: args.agentId,
          type: parsed.data.type,
          title: parsed.data.title,
          body: parsed.data.body,
          payload: parsed.data.payload,
          groundingRefs: [...parsed.data.groundingRefs, ...groundingCalls],
          status: "pending",
          reviewReason: null,
          createdSim: args.now,
          reviewedAtWall: null,
        };
        deps.store.insertArtifact(artifact);
        deps.onArtifact(artifact);
        return `Artifact "${parsed.data.title}" submitted to the review queue.`;
      }
      if (name === "note_observation") {
        const note = String((input as { note?: unknown }).note ?? "");
        if (note) {
          notes.push(note);
          await deps.memory.append("observation", note, 4, args.now);
        }
        return "Noted.";
      }
      groundingCalls.push(`tool:${name}(${JSON.stringify(input).slice(0, 120)})`);
      return deps.tools.executeTool(name, input);
    },
  });

  // Distill the session itself into one memory.
  const outcome = artifact
    ? `Produced "${(artifact as Artifact).title}" for review.`
    : result.finalText.slice(0, 300);
  await deps.memory.append(
    "observation",
    `Work session — ${args.action}: ${outcome}`,
    artifact ? 6 : 4,
    args.now,
  );

  return { artifact, notes };
}

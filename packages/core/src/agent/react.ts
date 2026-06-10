import {
  reactDecisionJsonSchema,
  reactDecisionZ,
  type ReactDecisionOut,
  type SimMinutes,
} from "@virtual-sim/shared";
import type { LlmPort, LlmSystemBlock } from "../ports.js";
import type { MemoryStream } from "./memory.js";
import type { RetrievalParams } from "./retrieval.js";
import { reactPrompt } from "./prompts.js";
import { PRIORITY } from "../sim/scheduler.js";

export interface ReactDeps {
  llm: LlmPort;
  memory: MemoryStream;
  system: LlmSystemBlock[];
  retrievalParams: RetrievalParams;
}

/**
 * Continue-vs-react decision for a novel observation that passed the
 * importance gate. The caller handles the returned decision (replan or
 * start a conversation).
 */
export async function decideReaction(
  deps: ReactDeps,
  args: {
    now: SimMinutes;
    currentAction: string | null;
    observation: string;
    relationshipSummary: string | null;
  },
): Promise<ReactDecisionOut> {
  const retrieved = await deps.memory.retrieveByQuery(
    args.observation,
    args.now,
    deps.retrievalParams,
  );
  const res = await deps.llm.call({
    tier: "cognition",
    purpose: "react",
    system: deps.system,
    user: reactPrompt({
      now: args.now,
      currentAction: args.currentAction,
      observation: args.observation,
      relationshipSummary: args.relationshipSummary,
      retrieved: retrieved.map((r) => r.memory),
    }),
    jsonSchema: reactDecisionJsonSchema,
    maxTokens: 400,
    priority: PRIORITY.react,
  });
  return reactDecisionZ.parse(JSON.parse(res.text));
}

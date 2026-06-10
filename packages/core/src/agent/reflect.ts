import {
  reflectionInsightsJsonSchema,
  reflectionInsightsZ,
  reflectionQuestionsJsonSchema,
  reflectionQuestionsZ,
  type Memory,
  type SimMinutes,
} from "@virtual-sim/shared";
import type { LlmPort, LlmSystemBlock } from "../ports.js";
import type { MemoryStream } from "./memory.js";
import type { RetrievalParams } from "./retrieval.js";
import { reflectionInsightsPrompt, reflectionQuestionsPrompt } from "./prompts.js";
import { PRIORITY } from "../sim/scheduler.js";

export interface ReflectDeps {
  llm: LlmPort;
  memory: MemoryStream;
  system: LlmSystemBlock[];
  retrievalParams: RetrievalParams;
}

/**
 * Paper-faithful reflection: 3 salient questions over the last ~100
 * memories, per-question retrieval, cited insight synthesis. Returns the
 * created reflection memories.
 */
export async function reflect(deps: ReflectDeps, now: SimMinutes): Promise<Memory[]> {
  const recent = deps.memory.recent(100);
  if (recent.length < 5) return [];

  const qRes = await deps.llm.call({
    tier: "cognition",
    purpose: "reflect.questions",
    system: deps.system,
    user: reflectionQuestionsPrompt(recent),
    jsonSchema: reflectionQuestionsJsonSchema,
    maxTokens: 500,
    priority: PRIORITY.reflect,
  });
  const questions = reflectionQuestionsZ.parse(JSON.parse(qRes.text)).questions;

  const created: Memory[] = [];
  for (const question of questions) {
    const retrieved = await deps.memory.retrieveByQuery(question, now, deps.retrievalParams);
    if (retrieved.length === 0) continue;

    const iRes = await deps.llm.call({
      tier: "cognition",
      purpose: "reflect.insights",
      system: deps.system,
      user: reflectionInsightsPrompt(
        question,
        retrieved.map((r) => r.memory),
      ),
      jsonSchema: reflectionInsightsJsonSchema,
      maxTokens: 1200,
      priority: PRIORITY.reflect,
    });
    const insights = reflectionInsightsZ.parse(JSON.parse(iRes.text)).insights;

    for (const ins of insights) {
      // Only keep citations that point at real memories.
      const evidence = ins.evidence.filter((id) => deps.memory.byId(id) !== undefined);
      const mem = await deps.memory.append("reflection", ins.insight, 6, now, evidence);
      created.push(mem);
    }
  }

  deps.memory.resetReflectionAccumulator();
  return created;
}

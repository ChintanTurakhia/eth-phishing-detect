import { z } from "zod";

export const mcpServerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  transport: z.enum(["http", "stdio"]).default("http"),
  url: z.string().default(""),
  command: z.string().default(""),
});

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const simSettingsSchema = z.object({
  /** Sim-minutes advanced per wall-clock second while running. */
  speed: z.number().min(1).max(600).default(60),
  /** Reflection trigger: sum of importance since last reflection. */
  reflectionThreshold: z.number().min(10).max(1000).default(150),
  /** Retrieval params. */
  retrievalTopK: z.number().min(1).max(50).default(15),
  retrievalWeights: z
    .object({
      recency: z.number().default(1),
      importance: z.number().default(1),
      relevance: z.number().default(1),
    })
    .default({ recency: 1, importance: 1, relevance: 1 }),
  recencyDecay: z.number().min(0.9).max(0.9999).default(0.995),
  /** Minimum haiku importance for an observation to reach the opus react call. */
  reactGateImportance: z.number().min(1).max(10).default(4),
  /** Models. */
  cognitionModel: z.string().default("claude-opus-4-8"),
  utilityModel: z.string().default("claude-haiku-4-5"),
  adaptiveThinking: z.boolean().default(true),
  /** Max concurrent LLM calls. */
  llmConcurrency: z.number().min(1).max(16).default(4),
  /** Daily token budget (input+output) across all agents. 0 = unlimited. */
  dailyTokenBudget: z.number().min(0).default(2_000_000),
  /** Embeddings provider. */
  embeddings: z.enum(["local", "voyage"]).default("local"),
  /** Dialogue caps. */
  dialogueMaxTurns: z.number().min(2).max(40).default(12),
  dialogueMaxSimMinutes: z.number().min(2).max(120).default(10),
  /** MCP server configs, keyed by server name. */
  mcp: z
    .object({
      linear: mcpServerConfigSchema.default({}),
      slack: mcpServerConfigSchema.default({}),
      github: mcpServerConfigSchema.default({}),
      glean: mcpServerConfigSchema.default({}),
      snowflake: mcpServerConfigSchema.default({}),
    })
    .default({}),
});

export type SimSettings = z.infer<typeof simSettingsSchema>;

export const defaultSettings: SimSettings = simSettingsSchema.parse({});

/**
 * JSON Schemas passed to the Anthropic API via output_config.format
 * (structured outputs), plus matching zod validators for defense in depth.
 */
import { z } from "zod";

// ---------- Day plan ----------

export const dayPlanZ = z.object({
  chunks: z
    .array(
      z.object({
        summary: z.string(),
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(1).max(24),
        isWork: z.boolean(),
      }),
    )
    .min(3)
    .max(10),
});
export type DayPlanOut = z.infer<typeof dayPlanZ>;

export const dayPlanJsonSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          summary: { type: "string" },
          startHour: { type: "integer" },
          endHour: { type: "integer" },
          isWork: {
            type: "boolean",
            description:
              "true when the chunk produces concrete work product (code, docs, issues, analysis)",
          },
        },
        required: ["summary", "startHour", "endHour", "isWork"],
        additionalProperties: false,
      },
    },
  },
  required: ["chunks"],
  additionalProperties: false,
} as const;

// ---------- Hour / action decomposition ----------

export const actionListZ = z.object({
  actions: z
    .array(
      z.object({
        description: z.string(),
        locationHint: z.string(),
        durationMin: z.number().int().min(5).max(15),
      }),
    )
    .min(1)
    .max(12),
});
export type ActionListOut = z.infer<typeof actionListZ>;

export const actionListJsonSchema = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          locationHint: {
            type: "string",
            description: "area or object in the office where this happens",
          },
          durationMin: { type: "integer", enum: [5, 10, 15] },
        },
        required: ["description", "locationHint", "durationMin"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
} as const;

// ---------- React decision ----------

export const reactDecisionZ = z.object({
  decision: z.enum(["continue", "react", "initiate_dialogue"]),
  reaction: z.string().nullable(),
  openingLine: z.string().nullable(),
});
export type ReactDecisionOut = z.infer<typeof reactDecisionZ>;

export const reactDecisionJsonSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["continue", "react", "initiate_dialogue"] },
    reaction: {
      type: ["string", "null"],
      description: "if reacting: what the agent does instead, one sentence",
    },
    openingLine: {
      type: ["string", "null"],
      description: "if initiating dialogue: the first thing the agent says",
    },
  },
  required: ["decision", "reaction", "openingLine"],
  additionalProperties: false,
} as const;

// ---------- Dialogue turn ----------

export const dialogueTurnZ = z.object({
  utterance: z.string(),
  endsConversation: z.boolean(),
});
export type DialogueTurnOut = z.infer<typeof dialogueTurnZ>;

export const dialogueTurnJsonSchema = {
  type: "object",
  properties: {
    utterance: { type: "string" },
    endsConversation: {
      type: "boolean",
      description: "true when there is nothing substantive left to add",
    },
  },
  required: ["utterance", "endsConversation"],
  additionalProperties: false,
} as const;

// ---------- Reflection ----------

export const reflectionQuestionsZ = z.object({
  questions: z.array(z.string()).min(1).max(3),
});
export type ReflectionQuestionsOut = z.infer<typeof reflectionQuestionsZ>;

export const reflectionQuestionsJsonSchema = {
  type: "object",
  properties: {
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

export const reflectionInsightsZ = z.object({
  insights: z
    .array(
      z.object({
        insight: z.string(),
        evidence: z.array(z.string()),
      }),
    )
    .min(1)
    .max(5),
});
export type ReflectionInsightsOut = z.infer<typeof reflectionInsightsZ>;

export const reflectionInsightsJsonSchema = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          insight: { type: "string" },
          evidence: {
            type: "array",
            items: { type: "string" },
            description: "IDs of the memories that support this insight",
          },
        },
        required: ["insight", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["insights"],
  additionalProperties: false,
} as const;

// ---------- Importance scoring (batched) ----------

export const importanceScoresZ = z.object({
  scores: z.array(z.number().int().min(1).max(10)),
});
export type ImportanceScoresOut = z.infer<typeof importanceScoresZ>;

export const importanceScoresJsonSchema = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: { type: "integer" },
      description: "one score 1-10 per numbered item, in order",
    },
  },
  required: ["scores"],
  additionalProperties: false,
} as const;

// ---------- Location choice ----------

export const locationChoiceZ = z.object({ choice: z.string() });
export type LocationChoiceOut = z.infer<typeof locationChoiceZ>;

export const locationChoiceJsonSchema = {
  type: "object",
  properties: {
    choice: { type: "string", description: "exactly one of the listed option names" },
  },
  required: ["choice"],
  additionalProperties: false,
} as const;

// ---------- Artifact production (virtual tool input) ----------

export const produceArtifactZ = z.object({
  type: z.enum(["pr_proposal", "linear_issue", "idea_doc", "debate_summary", "review_note"]),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.unknown()),
  groundingRefs: z.array(z.string()),
});
export type ProduceArtifactIn = z.infer<typeof produceArtifactZ>;

export const produceArtifactJsonSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["pr_proposal", "linear_issue", "idea_doc", "debate_summary", "review_note"],
    },
    title: { type: "string" },
    body: {
      type: "string",
      description: "full markdown body the human reviewer will read",
    },
    payload: {
      type: "object",
      description:
        "machine-shaped arguments for the eventual real write (e.g. {repo, baseBranch, title, body, files} for a PR; {teamId, title, description, priority, labels} for a Linear issue)",
    },
    groundingRefs: {
      type: "array",
      items: { type: "string" },
      description: "URIs or tool-call references for the sources used",
    },
  },
  required: ["type", "title", "body", "payload", "groundingRefs"],
  additionalProperties: false,
} as const;

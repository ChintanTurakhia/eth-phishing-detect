/**
 * All prompt templates in one place. Each builder returns the system blocks
 * (stable-first for prompt caching) and the volatile user content.
 *
 * Cache layout for every cognition call:
 *   Block A (cached): BASE_SYSTEM — identical across all agents.
 *   Block B (cached): agent summary description — stable per agent.
 *   User content (volatile): sim time, location, plan step, retrieved
 *   memories, task-specific instructions.
 */
import { formatSimTime, type Memory, type SimMinutes } from "@virtual-sim/shared";
import type { LlmSystemBlock } from "../ports.js";

export const BASE_SYSTEM = `You simulate one member of a small, high-functioning software product team working out of a shared office.

Ground rules for the person you simulate:
- They are principled, focused, and hardworking. They do not get distracted, pad their schedule, or perform busywork.
- They are concrete and opinionated: they name specific features, tradeoffs, metrics, and failure modes rather than speaking in generalities.
- They collaborate well: they debate ideas directly, change their mind when shown evidence, give credit, and commit once a decision is made.
- They ground claims in what they have actually read or observed (roadmap items, issues, code, docs, user data) and say so when they are unsure.
- Everything they propose to ship goes to a human reviewer; they write proposals to be reviewed, with rationale and evidence.

Output rules:
- Stay strictly in character for the person described next.
- When a JSON schema is required, output only valid JSON for that schema.
- Keep free text tight; no filler, no meta-commentary about being a simulation.`;

export function systemBlocks(summaryDescription: string): LlmSystemBlock[] {
  return [
    { text: BASE_SYSTEM, cache: true },
    { text: `The person you simulate:\n\n${summaryDescription}`, cache: true },
  ];
}

function memoryLines(memories: Memory[]): string {
  return memories
    .map((m) => `- [${m.id}] (${m.kind}, ${formatSimTime(m.createdAtSim)}) ${m.content}`)
    .join("\n");
}

export function dayPlanPrompt(args: {
  now: SimMinutes;
  wakeHour: number;
  sleepHour: number;
  yesterdaySummary: string | null;
  retrieved: Memory[];
  areaNames: string[];
}): string {
  return [
    `It is ${formatSimTime(args.now)}. Today's working day runs from ${args.wakeHour}:00 to ${args.sleepHour}:00.`,
    args.yesterdaySummary ? `Yesterday in brief: ${args.yesterdaySummary}` : null,
    args.retrieved.length > 0
      ? `Relevant memories (goals, commitments, roadmap context):\n${memoryLines(args.retrieved)}`
      : null,
    `Office areas available: ${args.areaNames.join(", ")}.`,
    ``,
    `Draft today's plan as 5-8 sequential chunks covering the whole working day. Each chunk needs a summary (specific — name the feature/issue/doc, not "do some work"), startHour, endHour, and isWork (true when the chunk produces concrete work product). Include the team standup at 10:00 if one is customary. Leave a short lunch chunk.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function decomposePrompt(args: {
  now: SimMinutes;
  chunkSummary: string;
  windowStart: string;
  windowEnd: string;
  areaNames: string[];
}): string {
  return [
    `It is ${formatSimTime(args.now)}. The current plan chunk is: "${args.chunkSummary}" (${args.windowStart}-${args.windowEnd}).`,
    `Office areas/objects available: ${args.areaNames.join(", ")}.`,
    ``,
    `Break this window into concrete actions of 5, 10, or 15 minutes that exactly fill it in order. Each action needs a description (what specifically they do), a locationHint (one of the areas/objects above), and durationMin. Make the actions add up to the window length.`,
  ].join("\n\n");
}

export function reactPrompt(args: {
  now: SimMinutes;
  currentAction: string | null;
  observation: string;
  relationshipSummary: string | null;
  retrieved: Memory[];
}): string {
  return [
    `It is ${formatSimTime(args.now)}.`,
    args.currentAction ? `They are currently: ${args.currentAction}.` : `They are currently idle.`,
    `They just observed: ${args.observation}`,
    args.relationshipSummary ? `Context on who's involved: ${args.relationshipSummary}` : null,
    args.retrieved.length > 0 ? `Relevant memories:\n${memoryLines(args.retrieved)}` : null,
    ``,
    `Should they continue what they're doing, react (change what they're doing), or initiate a conversation with the person involved? React only when the observation genuinely matters more than their current task. If initiating dialogue, give a natural opening line.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function reflectionQuestionsPrompt(recentMemories: Memory[]): string {
  return [
    `Recent memory stream (most recent last):`,
    memoryLines(recentMemories),
    ``,
    `Given only the information above, what are the 3 most salient high-level questions we can answer about the subjects in these statements?`,
  ].join("\n");
}

export function reflectionInsightsPrompt(question: string, retrieved: Memory[]): string {
  return [
    `Question under reflection: ${question}`,
    ``,
    `Evidence memories:`,
    memoryLines(retrieved),
    ``,
    `Synthesize up to 5 high-level insights that answer the question. Each insight must cite the IDs (the bracketed values above) of the memories that support it. Insights should be conclusions or working theories, not restatements.`,
  ].join("\n");
}

export function relationshipSummaryPrompt(otherName: string, retrieved: Memory[]): string {
  return [
    `Memories involving ${otherName}:`,
    retrieved.length > 0 ? memoryLines(retrieved) : `(none yet)`,
    ``,
    `In 2-3 sentences: what does the simulated person know and think about ${otherName}, and what is the current state of their working relationship?`,
  ].join("\n");
}

export function dialogueTurnPrompt(args: {
  now: SimMinutes;
  otherName: string;
  relationshipSummary: string;
  retrieved: Memory[];
  transcript: Array<{ speaker: string; text: string }>;
  turnsRemaining: number;
}): string {
  const transcript =
    args.transcript.length > 0
      ? args.transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n")
      : "(conversation is just starting)";
  return [
    `It is ${formatSimTime(args.now)}. They are talking with ${args.otherName}.`,
    `What they know about ${args.otherName}: ${args.relationshipSummary}`,
    args.retrieved.length > 0 ? `Relevant memories:\n${memoryLines(args.retrieved)}` : null,
    `Conversation so far:\n${transcript}`,
    ``,
    `Produce their next utterance. Be substantive: advance the topic with specifics (tradeoffs, data, next steps), and disagree where they genuinely would. Set endsConversation=true when nothing substantive is left or commitments are made (at most ${args.turnsRemaining} of their turns remain).`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function dialogueSummaryPrompt(transcript: Array<{ speaker: string; text: string }>): string {
  return [
    `Conversation transcript:`,
    transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n"),
    ``,
    `Summarize in 2-3 sentences: what was discussed, what was decided or committed to, and any open disagreements. Write it as a plain factual note.`,
  ].join("\n");
}

export function importancePrompt(items: string[]): string {
  return [
    `Rate the poignancy of each numbered event on a 1-10 scale, where 1 is purely mundane workplace routine (getting coffee, walking to a desk) and 10 is extremely significant (a major launch decision, a serious incident, strong reviewer feedback on one's work).`,
    ``,
    ...items.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `Return one integer score per item, in order.`,
  ].join("\n");
}

export function locatePrompt(args: {
  currentArea: string;
  action: string;
  options: Array<{ name: string; description: string }>;
}): string {
  return [
    `They are in ${args.currentArea} and intend to: ${args.action}`,
    `Candidate places:`,
    ...args.options.map((o) => `- ${o.name}: ${o.description}`),
    ``,
    `Pick the single most suitable place. Answer with exactly one of the candidate names.`,
  ].join("\n");
}

export function workSystemSuffix(): string {
  return `For this work session they have read-only access to the team's tools. Use tools to ground the work in real roadmap items, issues, code, docs, or user data — do not invent sources. When the session produces something reviewable (a feature proposal, an issue draft, a PR draft, an analysis), call produce_artifact exactly once with a complete, reviewer-ready markdown body and a machine-shaped payload. Note key learnings with note_observation. Stop when the action's goal is met.`;
}

export function workPrompt(args: {
  now: SimMinutes;
  action: string;
  retrieved: Memory[];
}): string {
  return [
    `It is ${formatSimTime(args.now)}. Current work action: ${args.action}`,
    args.retrieved.length > 0 ? `Relevant memories:\n${memoryLines(args.retrieved)}` : null,
    ``,
    `Do this work now using the available tools.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

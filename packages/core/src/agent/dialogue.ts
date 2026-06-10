import {
  dialogueSummaryPrompt,
  dialogueTurnPrompt,
  relationshipSummaryPrompt,
} from "./prompts.js";
import {
  dialogueTurnJsonSchema,
  dialogueTurnZ,
  type Conversation,
  type SimMinutes,
  type Utterance,
} from "@virtual-sim/shared";
import type { LlmPort, LlmSystemBlock, StorePort } from "../ports.js";
import { newId } from "../ports.js";
import type { MemoryStream } from "./memory.js";
import type { RetrievalParams } from "./retrieval.js";
import { PRIORITY } from "../sim/scheduler.js";

export interface DialogueParticipant {
  agentId: string;
  name: string;
  system: LlmSystemBlock[];
  memory: MemoryStream;
}

export interface DialogueDeps {
  llm: LlmPort;
  store: StorePort;
  retrievalParams: RetrievalParams;
  maxTurns: number;
}

/**
 * Controller for one two-party conversation. The sim loop calls
 * `step()` repeatedly (one utterance per call) until `ended`.
 */
export class DialogueController {
  readonly conversation: Conversation;
  private transcript: Array<{ speaker: string; text: string }> = [];
  private turnIndex = 0;
  private relationshipCache = new Map<string, { atSimHour: number; text: string }>();
  ended = false;
  utterances: Utterance[] = [];

  constructor(
    private readonly deps: DialogueDeps,
    private readonly a: DialogueParticipant,
    private readonly b: DialogueParticipant,
    startedSim: SimMinutes,
    location: string,
    openingLine: string | null,
  ) {
    this.conversation = {
      id: newId("conv"),
      participants: [a.agentId, b.agentId],
      startedSim,
      endedSim: null,
      summary: null,
      location,
    };
    deps.store.insertConversation(this.conversation);
    if (openingLine) {
      // The initiator's opening line counts as turn 0.
      this.pushUtterance(this.a, openingLine, startedSim);
      this.turnIndex = 1;
    }
  }

  get currentSpeaker(): DialogueParticipant {
    return this.turnIndex % 2 === 0 ? this.a : this.b;
  }

  get listener(): DialogueParticipant {
    return this.turnIndex % 2 === 0 ? this.b : this.a;
  }

  /** Generate the next utterance. Returns it, or null if the conversation ended. */
  async step(now: SimMinutes): Promise<Utterance | null> {
    if (this.ended) return null;
    if (this.turnIndex >= this.deps.maxTurns) {
      await this.end(now);
      return null;
    }
    const speaker = this.currentSpeaker;
    const other = this.listener;

    const relationship = await this.relationshipSummary(speaker, other, now);
    const retrieved = await speaker.memory.retrieveByQuery(
      `conversation with ${other.name}: ${this.transcript.slice(-2).map((t) => t.text).join(" ") || "starting a conversation"}`,
      now,
      this.deps.retrievalParams,
    );

    const res = await this.deps.llm.call({
      tier: "cognition",
      purpose: "dialogue.turn",
      system: speaker.system,
      user: dialogueTurnPrompt({
        now,
        otherName: other.name,
        relationshipSummary: relationship,
        retrieved: retrieved.map((r) => r.memory),
        transcript: this.transcript,
        turnsRemaining: Math.ceil((this.deps.maxTurns - this.turnIndex) / 2),
      }),
      jsonSchema: dialogueTurnJsonSchema,
      maxTokens: 600,
      priority: PRIORITY.dialogue,
    });
    const turn = dialogueTurnZ.parse(JSON.parse(res.text));

    const utterance = this.pushUtterance(speaker, turn.utterance, now);
    this.turnIndex += 1;

    if (turn.endsConversation) await this.end(now);
    return utterance;
  }

  /** End the conversation: summarize, write a summary memory for both sides. */
  async end(now: SimMinutes): Promise<string> {
    if (this.ended) return this.conversation.summary ?? "";
    this.ended = true;

    let summary = `Talked with no substantive outcome.`;
    if (this.transcript.length > 0) {
      const res = await this.deps.llm.call({
        tier: "cognition",
        purpose: "dialogue.summary",
        system: this.a.system,
        user: dialogueSummaryPrompt(this.transcript),
        maxTokens: 400,
        priority: PRIORITY.dialogue,
      });
      summary = res.text.trim();
    }
    this.conversation.endedSim = now;
    this.conversation.summary = summary;
    this.deps.store.endConversation(this.conversation.id, now, summary);

    await this.a.memory.append(
      "observation",
      `Conversation with ${this.b.name}: ${summary}`,
      5,
      now,
    );
    await this.b.memory.append(
      "observation",
      `Conversation with ${this.a.name}: ${summary}`,
      5,
      now,
    );
    return summary;
  }

  private pushUtterance(speaker: DialogueParticipant, text: string, now: SimMinutes): Utterance {
    const u: Utterance = {
      id: newId("utt"),
      conversationId: this.conversation.id,
      agentId: speaker.agentId,
      content: text,
      simTime: now,
      seq: this.transcript.length,
    };
    this.transcript.push({ speaker: speaker.name, text });
    this.utterances.push(u);
    this.deps.store.insertUtterance(u);
    // Both parties remember each utterance (paper: dialogue memories).
    void speaker.memory.append("dialogue", `${speaker.name} said: "${text}"`, 3, now);
    const listener = speaker === this.a ? this.b : this.a;
    void listener.memory.append("dialogue", `${speaker.name} said to me: "${text}"`, 3, now);
    return u;
  }

  /** Cached per pair per sim-hour. */
  private async relationshipSummary(
    speaker: DialogueParticipant,
    other: DialogueParticipant,
    now: SimMinutes,
  ): Promise<string> {
    const hour = Math.floor(now / 60);
    const cached = this.relationshipCache.get(speaker.agentId);
    if (cached && cached.atSimHour === hour) return cached.text;

    const retrieved = await speaker.memory.retrieveByQuery(
      `${other.name}: relationship, past conversations, opinions of their work`,
      now,
      this.deps.retrievalParams,
    );
    const res = await this.deps.llm.call({
      tier: "cognition",
      purpose: "relationship.summary",
      system: speaker.system,
      user: relationshipSummaryPrompt(
        other.name,
        retrieved.map((r) => r.memory),
      ),
      maxTokens: 300,
      priority: PRIORITY.dialogue,
    });
    const text = res.text.trim();
    this.relationshipCache.set(speaker.agentId, { atSimHour: hour, text });
    return text;
  }
}

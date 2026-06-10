import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmPort,
  LlmRequest,
  LlmResponse,
  ToolLoopRequest,
  ToolLoopResult,
} from "@virtual-sim/core";
import type { BudgetManager } from "./budget.js";
import { BudgetExhaustedError } from "./budget.js";

export interface AnthropicLlmOptions {
  cognitionModel: string;
  utilityModel: string;
  adaptiveThinking: boolean;
}

/**
 * LlmPort over the official Anthropic SDK.
 *
 * Prompt-cache layout: the caller supplies system blocks ordered
 * stable-first; every block flagged `cache: true` gets a cache_control
 * breakpoint so the shared base prompt + per-agent identity are reused
 * across all of that agent's calls.
 */
export class AnthropicLlm implements LlmPort {
  private client: Anthropic;

  constructor(
    private opts: AnthropicLlmOptions,
    private readonly budget: BudgetManager,
  ) {
    this.client = new Anthropic();
  }

  setModels(opts: AnthropicLlmOptions): void {
    this.opts = opts;
  }

  private model(tier: "cognition" | "utility"): string {
    return tier === "cognition" ? this.opts.cognitionModel : this.opts.utilityModel;
  }

  private systemParam(blocks: LlmRequest["system"]): Anthropic.TextBlockParam[] | undefined {
    if (blocks.length === 0) return undefined;
    return blocks.map((b) => ({
      type: "text" as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
  }

  async call(req: LlmRequest): Promise<LlmResponse> {
    if (!this.budget.allows(req.purpose)) throw new BudgetExhaustedError(req.purpose);
    const model = this.model(req.tier);

    const params: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 2000,
      system: this.systemParam(req.system),
      messages: [{ role: "user", content: req.user }],
    };
    if (req.tier === "cognition" && this.opts.adaptiveThinking) {
      params.thinking = { type: "adaptive" };
    }
    if (req.jsonSchema) {
      params.output_config = { format: { type: "json_schema", schema: req.jsonSchema } };
    }

    const response = (await this.client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
    )) as Anthropic.Message;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const usage = response.usage;
    this.budget.record(
      model,
      req.purpose,
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_read_input_tokens ?? 0,
    );
    return { text, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  }

  async toolLoop(req: ToolLoopRequest): Promise<ToolLoopResult> {
    if (!this.budget.allows(req.purpose)) throw new BudgetExhaustedError(req.purpose);
    const model = this.model(req.tier);

    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: req.user }];
    const toolCallsMade: ToolLoopResult["toolCallsMade"] = [];
    let totalIn = 0;
    let totalOut = 0;
    let finalText = "";

    for (let round = 0; round <= req.maxRounds; round++) {
      const params: Record<string, unknown> = {
        model,
        max_tokens: req.maxTokens ?? 4000,
        system: this.systemParam(req.system),
        messages,
        tools,
      };
      if (this.opts.adaptiveThinking) params.thinking = { type: "adaptive" };

      const response = (await this.client.messages.create(
        params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      )) as Anthropic.Message;

      totalIn += response.usage.input_tokens;
      totalOut += response.usage.output_tokens;
      this.budget.record(
        model,
        req.purpose,
        response.usage.input_tokens,
        response.usage.output_tokens,
        response.usage.cache_read_input_tokens ?? 0,
      );

      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (response.stop_reason !== "tool_use") break;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = tu.input as Record<string, unknown>;
        toolCallsMade.push({ name: tu.name, input });
        let result: string;
        try {
          result = await req.execute(tu.name, input);
        } catch (err) {
          result = `Error: ${(err as Error).message}`;
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      }
      messages.push({ role: "user", content: results });
    }

    return { finalText, toolCallsMade, inputTokens: totalIn, outputTokens: totalOut };
  }
}

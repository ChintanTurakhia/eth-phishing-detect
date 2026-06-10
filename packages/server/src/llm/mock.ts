import type {
  LlmPort,
  LlmRequest,
  LlmResponse,
  ToolLoopRequest,
  ToolLoopResult,
} from "@virtual-sim/core";

/**
 * Deterministic offline LLM: canned, purpose-shaped responses. Used when no
 * ANTHROPIC_API_KEY is configured and by the integration tests, so the
 * whole sim (planning, dialogue, reflection, work artifacts) runs with
 * zero network.
 */
export class MockLlm implements LlmPort {
  private dialogueCounters = new Map<string, number>();

  async call(req: LlmRequest): Promise<LlmResponse> {
    const text = this.respond(req);
    return { text, inputTokens: 50, outputTokens: 50 };
  }

  private respond(req: LlmRequest): string {
    switch (req.purpose) {
      case "plan.day": {
        const isPm = req.system.some((b) => b.text.includes("Product Manager"));
        const chunks = isPm
          ? [
              { summary: "Review overnight customer-voice messages and churn numbers", startHour: 8, endHour: 9, isWork: false },
              { summary: "Draft the scheduled-exports issue breakdown from the PRD", startHour: 9, endHour: 10, isWork: true },
              { summary: "Run the team standup at the standup corner", startHour: 10, endHour: 11, isWork: false },
              { summary: "Analyze activation funnel data for the onboarding bet", startHour: 11, endHour: 13, isWork: true },
              { summary: "Lunch in the kitchen", startHour: 13, endHour: 14, isWork: false },
              { summary: "Write next week's roadmap update", startHour: 14, endHour: 16, isWork: true },
              { summary: "1:1 syncs and review queue follow-ups", startHour: 16, endHour: 18, isWork: false },
            ]
          : [
              { summary: "Read new PRs and the read-API spec", startHour: 8, endHour: 9, isWork: false },
              { summary: "Work on the read API rate limiting", startHour: 9, endHour: 10, isWork: true },
              { summary: "Team standup at the standup corner", startHour: 10, endHour: 11, isWork: false },
              { summary: "Deep work: export scheduler design", startHour: 11, endHour: 13, isWork: true },
              { summary: "Lunch in the kitchen", startHour: 13, endHour: 14, isWork: false },
              { summary: "Review teammates' PRs and write feedback", startHour: 14, endHour: 16, isWork: true },
              { summary: "Investigate the dashboard p95 regression", startHour: 16, endHour: 19, isWork: true },
            ];
        return JSON.stringify({ chunks });
      }
      case "plan.decompose":
        return JSON.stringify({
          actions: [
            { description: "review the relevant issue and recent discussion", locationHint: "the bullpen", durationMin: 15 },
            { description: "work through the main task at the desk", locationHint: "the bullpen", durationMin: 15 },
            { description: "sketch open questions on the whiteboard", locationHint: "the war room", durationMin: 15 },
            { description: "write down conclusions and next steps", locationHint: "the bullpen", durationMin: 15 },
          ],
        });
      case "react": {
        // Submitted work prompts a hallway conversation; reviewer feedback
        // already replans via the host, everything else continues.
        if (req.user.includes("submitted")) {
          return JSON.stringify({
            decision: "initiate_dialogue",
            reaction: null,
            openingLine: "Saw your export proposal go up for review — got a minute to talk through the S3 multipart risk?",
          });
        }
        return JSON.stringify({ decision: "continue", reaction: null, openingLine: null });
      }
      case "reflect.questions":
        return JSON.stringify({
          questions: [
            "What is blocking the Q3 export work?",
            "How is the team coordinating on the roadmap?",
            "What do customers need most urgently?",
          ],
        });
      case "reflect.insights":
        return JSON.stringify({
          insights: [
            {
              insight: "Export capability is the team's highest-leverage work right now",
              evidence: extractIds(req.user).slice(0, 3),
            },
          ],
        });
      case "dialogue.turn": {
        const key = req.system[1]?.text.slice(0, 40) ?? "x";
        const n = (this.dialogueCounters.get(key) ?? 0) + 1;
        this.dialogueCounters.set(key, n);
        const lines = [
          "Quick sync — where are we on the export scheduler?",
          "I spiked it on the alerting cron; multipart upload for the big dashboards is the open risk.",
          "Let's scope CSV-only first and ship behind a flag; Parquet follows.",
          "Agreed. I'll write it up and get it into review today.",
        ];
        const ends = n >= 4 || /at most [12] of/.test(req.user);
        return JSON.stringify({ utterance: lines[(n - 1) % lines.length], endsConversation: ends });
      }
      case "dialogue.summary":
        return "Discussed the export scheduler: agreed to ship CSV-only first behind a flag, with Parquet as a follow-up. Linus writes it up for review today.";
      case "relationship.summary":
        return "A trusted teammate they work with daily; communication is direct and productive.";
      case "importance": {
        const items = req.user.split("\n").filter((l) => /^\d+\./.test(l));
        const scores = items.map((l) =>
          /review|submitted|incident|reviewer/i.test(l) ? 6 : /standup|conversation/i.test(l) ? 4 : 3,
        );
        return JSON.stringify({ scores: scores.length > 0 ? scores : [3] });
      }
      case "locate":
        return JSON.stringify({ choice: "the bullpen" });
      case "summary.refresh":
        return req.system[1]?.text ?? "";
      case "work":
        return "Completed the work session.";
      default:
        return "ok";
    }
  }

  async toolLoop(req: ToolLoopRequest): Promise<ToolLoopResult> {
    const toolCallsMade: ToolLoopResult["toolCallsMade"] = [];
    const readTools = req.tools.filter(
      (t) => t.name !== "produce_artifact" && t.name !== "note_observation",
    );

    // Read up to two grounding sources.
    for (const t of readTools.slice(0, 2)) {
      const input: Record<string, unknown> = {};
      toolCallsMade.push({ name: t.name, input });
      await req.execute(t.name, input);
    }
    // Note one observation.
    await req.execute("note_observation", {
      note: "Export demand is concentrated in the enterprise tier; LUM-341 is the renewal blocker.",
    });
    // Produce one artifact.
    const artifactInput = {
      type: "linear_issue",
      title: "Scheduled CSV export: phased delivery plan",
      body: [
        "## Proposal",
        "Ship scheduled CSV exports (LUM-341) in two phases: (1) daily email/S3 CSV behind a flag for enterprise, (2) Parquet + weekly schedules (LUM-371).",
        "",
        "## Evidence",
        "- Churn data: `no_data_export` is the top coded reason (27%, $412k ARR lost)",
        "- Maxwell Corp renewal ($240k) explicitly blocked on nightly CSVs",
        "- Linus's spike (lumen-pipeline#302) shows the alerting cron can host the scheduler",
        "",
        "## Risks",
        "- S3 multipart needed for >5GB dashboards (Maxwell's main board is 11M rows)",
      ].join("\n"),
      payload: {
        teamId: "team_plat",
        title: "Scheduled CSV export: phased delivery plan",
        description: "Phase 1: daily CSV to email/S3 behind enterprise flag. Phase 2: Parquet + weekly.",
        priority: 1,
        labels: ["q3", "exports"],
      },
      groundingRefs: ["linear:LUM-341", "snowflake:churn_reasons", "github:lumen-pipeline#302"],
    };
    toolCallsMade.push({ name: "produce_artifact", input: artifactInput });
    await req.execute("produce_artifact", artifactInput);

    return {
      finalText: "Drafted the phased export plan and submitted it for review.",
      toolCallsMade,
      inputTokens: 200,
      outputTokens: 200,
    };
  }
}

function extractIds(text: string): string[] {
  return [...text.matchAll(/\[(mem_[a-z0-9]+)\]/g)].map((m) => m[1]!);
}

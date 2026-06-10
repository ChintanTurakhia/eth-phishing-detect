# Virtual-sim

A virtual software team of **generative agents**, built on the architecture from
[*Generative Agents: Interactive Simulacra of Human Behavior*](https://arxiv.org/abs/2304.03442)
(Park et al., 2023) — repurposed from a small-town social sim into a
high-functioning engineering team you can seed, watch, and review.

Each agent is defined by a `soul.md` identity file and has the paper's full
cognitive stack:

| Mechanism | Implementation |
|---|---|
| **Memory stream** | Append-only natural-language memories (observations, reflections, plans, dialogue) with embeddings |
| **Retrieval** | `norm(recency) + norm(importance) + norm(relevance)`; recency = 0.995^(sim-hours since last access), importance LLM-scored 1–10 at write, relevance = cosine similarity |
| **Reflection** | Triggered when accumulated importance > threshold (150): 3 salient questions → per-question retrieval → cited insights |
| **Planning** | Day plan (5–8 chunks) lazily decomposed into 5–15-minute actions with locations; re-plans from "now" when reacting |
| **Dialogue** | Turns conditioned on each agent's summarized memories of the other; both sides remember every utterance |
| **Environment** | Containment tree (office → rooms → objects) with recursive location selection and A* movement |

Agents read your real team context — **Linear, Slack, GitHub, Glean, Snowflake —
via MCP, strictly read-only** (deny-by-default tool allowlist + SQL guard,
enforced at execution time). Anything they want to *write* (a Linear issue, a
PR, an idea doc) becomes an **artifact in your review queue**. Accept or reject
with a reason; the decision is injected into the agent's memory at high
importance and a rejection makes the agent revise.

Unconfigured MCP servers fall back to bundled mock fixtures (a fictional
analytics product, "Lumen"), and without an `ANTHROPIC_API_KEY` the sim runs on
a deterministic mock LLM — so the whole thing works offline, end to end.

## Quick start

```bash
pnpm install
cp .env.example .env          # set ANTHROPIC_API_KEY for real cognition (optional)
pnpm sim:seed                 # fresh DB + 4 agents + grounding memories
pnpm dev                      # server :4000 + web :3000
```

Open http://localhost:3000 and press **▶ Play**.

- **Dashboard view** — agent cards, live activity timeline, conversation
  transcripts, and a per-agent drawer: memory inspector (with a retrieval
  debugger showing the recency/importance/relevance score breakdown), the
  day → action plan tree, and the compiled soul.
- **Office view** — a live 2.5D office: agents walk between desks, the war
  room, the kitchen; speech bubbles, status emoji, day/night tint. Toggle in
  the top bar.
- **Review queue** (📋) — read each artifact's markdown body, grounding
  sources, and the machine-shaped payload (pre-shaped for the future real
  write). Accept, or reject with a reason and watch the agent react.
- **Settings** (⚙️) — sim speed and thresholds, retrieval weights, models and
  daily token budget, MCP server URLs, and soul editing (hot-reloads).

### Headless

```bash
pnpm sim:run -- --minutes 240   # advance 4 sim-hours, print a trace
```

## Architecture

```
packages/
  shared/    types, WS protocol, zod + JSON Schemas (structured outputs), settings
  core/      pure engine — no I/O; everything injected via ports
    sim/       game clock (1 tick = 1 sim-minute), priority scheduler, tick loop
    world/     environment tree, A* nav, perception dedupe
    agent/     memory, retrieval, reflection, planning, react, dialogue,
               locate, work loop, soul compiler, all prompts
  server/    SQLite (WAL — the DB is the state of record; kill it mid-day and
             resume), Anthropic SDK wrapper (prompt caching, adaptive thinking,
             structured outputs), budget manager with degradation, local MiniLM
             embeddings, MCP manager (read-only) + mocks, Fastify REST + WS hub
apps/
  web/       Next.js — dashboard + PixiJS office, zustand fed by one WS stream
souls/       agent identities (*.soul.md) — edit while running, hot-reloads
worlds/      office tilemap + containment tree
fixtures/    mock Linear/Slack/GitHub/Glean/Snowflake data
```

LLM usage: `claude-opus-4-8` (adaptive thinking, structured outputs) for
cognition — planning, reflection, reaction, dialogue, work sessions — and
`claude-haiku-4-5` for batched importance scoring. Prompts are laid out
stable-first (shared team prompt, then the agent's soul summary) with
`cache_control` breakpoints so each agent's identity is cached across all of
its calls. A per-day token budget degrades gracefully: reflections drop first,
then reactions, before anything core.

## soul.md format

```markdown
---
name: Ada Moreno
role: engineer        # engineer | pm | designer
team: Platform
desk: office.bullpen.desk-ada
avatar: ada
color: "#7c5cff"
wakeHour: 8
sleepHour: 19
---

# Identity
…third-person bio…

# Personality
# Expertise
# Values
# Quirks          (optional)
# Relationships   (optional)
```

## Tests

```bash
pnpm test
```

- **core** — retrieval math (decay, min-max normalization, lastAccessed
  rehearsal), scheduler concurrency/priority/coalescing, soul parsing, A*,
  replan boundaries.
- **server** — read-only policy (table-driven over every fixture tool + SQL
  guard), and a deterministic end-to-end run on the mock LLM asserting: day
  plans are 5–8 chunks; every action is 5–15 min with a location; dialogues
  end with summaries in both memories; reflections cite only existing memory
  IDs; artifacts carry write-shaped payloads; **no MCP write tool is ever
  invoked**; rejection injects an importance-9 memory and a revision action;
  the sim resumes from the DB.

## Roadmap (v2)

- **Real writes on accept** — artifact payloads are already shaped as the
  target MCP tool's arguments; accepting will validate against the tool's
  input schema and execute it.
- Nightly summary refresh folding reflections into each agent's identity.
- Sprite walk cycles and richer office art.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@virtual-sim/core";
import type { McpServerName } from "@virtual-sim/shared";
import { isReadOnlySql } from "./readonly.js";

export interface ToolSource {
  readonly server: McpServerName;
  tools(): AgentTool[];
  execute(toolName: string, input: Record<string, unknown>): Promise<string>;
}

function loadFixture<T>(fixturesDir: string, name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8")) as T;
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });

/** Fixture-backed in-process stand-ins for the five MCP servers. */
export function createMockSources(fixturesDir: string): ToolSource[] {
  return [
    linearMock(fixturesDir),
    slackMock(fixturesDir),
    githubMock(fixturesDir),
    gleanMock(fixturesDir),
    snowflakeMock(fixturesDir),
  ];
}

interface LinearFixture {
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; state: string; targetDate: string; description: string }>;
  issues: Array<{
    id: string;
    title: string;
    project: string | null;
    priority: number;
    state: string;
    assignee?: string;
    description: string;
  }>;
}

function linearMock(dir: string): ToolSource {
  const data = loadFixture<LinearFixture>(dir, "linear");
  return {
    server: "linear",
    tools: () => [
      {
        name: "list_projects",
        description: "List Linear projects (the roadmap) with state and descriptions.",
        inputSchema: obj({}),
      },
      {
        name: "list_issues",
        description: "List Linear issues, optionally filtered by project id or state.",
        inputSchema: obj({ project: str("project id"), state: str("todo|in_progress|backlog") }),
      },
      {
        name: "get_issue",
        description: "Get one Linear issue by id (e.g. LUM-341).",
        inputSchema: obj({ id: str("issue id") }, ["id"]),
      },
    ],
    execute: async (tool, input) => {
      if (tool === "list_projects") return JSON.stringify(data.projects, null, 1);
      if (tool === "list_issues") {
        let issues = data.issues;
        if (input.project) issues = issues.filter((i) => i.project === input.project);
        if (input.state) issues = issues.filter((i) => i.state === input.state);
        return JSON.stringify(issues, null, 1);
      }
      if (tool === "get_issue") {
        const issue = data.issues.find((i) => i.id === input.id);
        return issue ? JSON.stringify(issue, null, 1) : `No issue ${String(input.id)}`;
      }
      throw new Error(`unknown linear tool ${tool}`);
    },
  };
}

interface SlackFixture {
  channels: Array<{ id: string; name: string; topic: string }>;
  messages: Record<string, Array<{ user: string; ts: string; text: string }>>;
}

function slackMock(dir: string): ToolSource {
  const data = loadFixture<SlackFixture>(dir, "slack");
  return {
    server: "slack",
    tools: () => [
      {
        name: "list_channels",
        description: "List Slack channels with topics.",
        inputSchema: obj({}),
      },
      {
        name: "get_channel_history",
        description: "Read recent messages from a channel by name (e.g. customer-voice).",
        inputSchema: obj({ channel: str("channel name") }, ["channel"]),
      },
    ],
    execute: async (tool, input) => {
      if (tool === "list_channels") return JSON.stringify(data.channels, null, 1);
      if (tool === "get_channel_history") {
        const ch = data.channels.find((c) => c.name === input.channel || c.id === input.channel);
        if (!ch) return `No channel ${String(input.channel)}`;
        return JSON.stringify(data.messages[ch.id] ?? [], null, 1);
      }
      throw new Error(`unknown slack tool ${tool}`);
    },
  };
}

interface GithubFixture {
  repos: Array<{ name: string; description: string; defaultBranch: string }>;
  pulls: Array<{ repo: string; number: number; title: string; author: string; state: string; body: string; files?: string[] }>;
  files: Record<string, string>;
}

function githubMock(dir: string): ToolSource {
  const data = loadFixture<GithubFixture>(dir, "github");
  return {
    server: "github",
    tools: () => [
      {
        name: "list_pull_requests",
        description: "List pull requests across the team's repos.",
        inputSchema: obj({ repo: str("repo full name, optional") }),
      },
      {
        name: "get_file_contents",
        description: "Read a file from a repo. Path format: owner/repo:path/to/file",
        inputSchema: obj({ path: str("owner/repo:path") }, ["path"]),
      },
      {
        name: "search_code",
        description: "Search file contents and PR bodies for a keyword.",
        inputSchema: obj({ query: str("keyword") }, ["query"]),
      },
    ],
    execute: async (tool, input) => {
      if (tool === "list_pull_requests") {
        const pulls = input.repo ? data.pulls.filter((p) => p.repo === input.repo) : data.pulls;
        return JSON.stringify(pulls, null, 1);
      }
      if (tool === "get_file_contents") {
        const content = data.files[String(input.path)];
        return content ?? `No file at ${String(input.path)}`;
      }
      if (tool === "search_code") {
        const q = String(input.query).toLowerCase();
        const fileHits = Object.entries(data.files)
          .filter(([, content]) => content.toLowerCase().includes(q))
          .map(([path]) => path);
        const prHits = data.pulls
          .filter((p) => (p.title + p.body).toLowerCase().includes(q))
          .map((p) => `${p.repo}#${p.number} ${p.title}`);
        return JSON.stringify({ files: fileHits, pulls: prHits }, null, 1);
      }
      throw new Error(`unknown github tool ${tool}`);
    },
  };
}

interface GleanFixture {
  docs: Array<{ id: string; title: string; snippet: string }>;
}

function gleanMock(dir: string): ToolSource {
  const data = loadFixture<GleanFixture>(dir, "glean");
  return {
    server: "glean",
    tools: () => [
      {
        name: "search_docs",
        description: "Search internal docs (PRDs, strategy, research, postmortems).",
        inputSchema: obj({ query: str("search terms") }, ["query"]),
      },
    ],
    execute: async (tool, input) => {
      if (tool === "search_docs") {
        const q = String(input.query).toLowerCase();
        const terms = q.split(/\s+/).filter(Boolean);
        const hits = data.docs.filter((d) =>
          terms.some((t) => (d.title + " " + d.snippet).toLowerCase().includes(t)),
        );
        return JSON.stringify(hits.length > 0 ? hits : data.docs.slice(0, 3), null, 1);
      }
      throw new Error(`unknown glean tool ${tool}`);
    },
  };
}

interface SnowflakeFixture {
  tables: Array<{ name: string; description: string }>;
  cannedResults: Array<{ match: string; columns: string[]; rows: unknown[][] }>;
}

function snowflakeMock(dir: string): ToolSource {
  const data = loadFixture<SnowflakeFixture>(dir, "snowflake");
  return {
    server: "snowflake",
    tools: () => [
      {
        name: "describe_tables",
        description: "List the analytics tables available for querying.",
        inputSchema: obj({}),
      },
      {
        name: "run_query",
        description:
          "Run a read-only SQL query against the analytics warehouse (SELECT/SHOW/DESCRIBE/WITH only). Mention the topic (churn, activation, export, alert, dashboard load) in the query.",
        inputSchema: obj({ sql: str("a single read-only SQL statement") }, ["sql"]),
      },
    ],
    execute: async (tool, input) => {
      if (tool === "describe_tables") return JSON.stringify(data.tables, null, 1);
      if (tool === "run_query") {
        const sql = String(input.sql ?? "");
        if (!isReadOnlySql(sql)) {
          throw new Error("read-only policy: only single SELECT/SHOW/DESCRIBE/WITH statements are allowed");
        }
        const lower = sql.toLowerCase();
        const hit = data.cannedResults.find((r) => lower.includes(r.match));
        if (!hit) {
          return JSON.stringify({ columns: [], rows: [], note: "no rows; try churn, activation, export, alert, or dashboard load" });
        }
        return JSON.stringify({ columns: hit.columns, rows: hit.rows }, null, 1);
      }
      throw new Error(`unknown snowflake tool ${tool}`);
    },
  };
}

import type { AgentTool, ToolPort } from "@virtual-sim/core";
import type { McpServerName, McpServerStatus, SimSettings } from "@virtual-sim/shared";
import { assertReadOnlyExecution, isReadOnlyTool } from "./readonly.js";
import { createMockSources, type ToolSource } from "./mock.js";

/** Which servers each role can use in work sessions. */
const ROLE_SERVERS: Record<string, McpServerName[]> = {
  pm: ["linear", "slack", "glean", "snowflake"],
  engineer: ["linear", "slack", "github", "glean", "snowflake"],
  designer: ["linear", "slack", "glean"],
};

const SERVER_NAMES: McpServerName[] = ["linear", "slack", "github", "glean", "snowflake"];

/**
 * Combines live MCP clients and fixture mocks behind one ToolPort.
 * Tools are namespaced `server__tool`; read-only policy is enforced at
 * listing AND execution time.
 */
export class McpManager implements ToolPort {
  private sources = new Map<McpServerName, ToolSource>();
  private statuses = new Map<McpServerName, McpServerStatus>();

  constructor(
    private readonly fixturesDir: string,
    private readonly onStatus: (servers: McpServerStatus[]) => void,
  ) {}

  async configure(settings: SimSettings): Promise<void> {
    const mocks = new Map(createMockSources(this.fixturesDir).map((s) => [s.server, s]));
    for (const name of SERVER_NAMES) {
      const cfg = settings.mcp[name];
      const envUrl = process.env[`MCP_${name.toUpperCase()}_URL`];
      const url = cfg.url || envUrl || "";
      if (cfg.enabled && cfg.transport === "http" && url) {
        try {
          const source = await connectLive(name, url);
          this.sources.set(name, source);
          this.setStatus(name, { mode: "live", connected: true, toolCount: source.tools().length, error: null });
          continue;
        } catch (err) {
          this.setStatus(name, {
            mode: "mock",
            connected: true,
            toolCount: mocks.get(name)?.tools().length ?? 0,
            error: `live connect failed: ${(err as Error).message.slice(0, 120)}; using mock`,
          });
        }
      } else {
        this.setStatus(name, {
          mode: "mock",
          connected: true,
          toolCount: mocks.get(name)?.tools().length ?? 0,
          error: null,
        });
      }
      this.sources.set(name, mocks.get(name)!);
    }
    this.onStatus(this.statusList());
  }

  private setStatus(name: McpServerName, s: Omit<McpServerStatus, "name">): void {
    this.statuses.set(name, { name, ...s });
  }

  statusList(): McpServerStatus[] {
    return SERVER_NAMES.map((n) => this.statuses.get(n)).filter((s): s is McpServerStatus => !!s);
  }

  listTools(role: string): AgentTool[] {
    const servers = ROLE_SERVERS[role] ?? ROLE_SERVERS.engineer!;
    const out: AgentTool[] = [];
    for (const server of servers) {
      const source = this.sources.get(server);
      if (!source) continue;
      for (const t of source.tools()) {
        if (!isReadOnlyTool(t.name)) continue;
        out.push({
          name: `${server}__${t.name}`,
          description: `[${server}] ${t.description}`,
          inputSchema: t.inputSchema,
        });
      }
    }
    return out;
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const sep = name.indexOf("__");
    if (sep < 0) throw new Error(`malformed tool name ${name}`);
    const server = name.slice(0, sep) as McpServerName;
    const tool = name.slice(sep + 2);
    const source = this.sources.get(server);
    if (!source) throw new Error(`unknown MCP server ${server}`);
    assertReadOnlyExecution(server, tool, input);
    const result = await source.execute(tool, input);
    // Keep tool results bounded so the work loop's context stays small.
    return result.length > 6000 ? result.slice(0, 6000) + "\n…(truncated)" : result;
  }
}

/** Connect a live MCP server over Streamable HTTP and adapt it to ToolSource. */
async function connectLive(server: McpServerName, url: string): Promise<ToolSource> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const client = new Client({ name: "virtual-sim", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const listed = await client.listTools();
  const tools: AgentTool[] = listed.tools
    .filter((t) =>
      isReadOnlyTool(t.name, t.annotations as { readOnlyHint?: boolean } | undefined),
    )
    .map((t) => ({
      name: t.name,
      description: t.description ?? t.name,
      inputSchema: t.inputSchema as object,
    }));
  return {
    server,
    tools: () => tools,
    execute: async (toolName, input) => {
      const res = await client.callTool({ name: toolName, arguments: input });
      const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
      return content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
    },
  };
}

/**
 * Read-only enforcement: deny by default. A tool is exposed/executable only
 * if its name matches the read-verb allowlist, is not explicitly denied,
 * and (for live MCP tools) is not annotated as mutating. Snowflake queries
 * additionally pass a SQL guard. Enforced both at listing and at execution.
 */

const READ_VERB = /^(get|list|search|read|fetch|query|describe|run_query|show)([_a-z0-9]*)$/;

const DENYLIST = new Set([
  "create_issue",
  "update_issue",
  "delete_issue",
  "create_comment",
  "send_message",
  "post_message",
  "create_pull_request",
  "merge_pull_request",
  "push_files",
  "create_or_update_file",
  "delete_file",
  "execute",
  "write",
]);

export function isReadOnlyTool(
  toolName: string,
  annotations?: { readOnlyHint?: boolean },
): boolean {
  const bare = toolName.toLowerCase();
  if (DENYLIST.has(bare)) return false;
  if (annotations && annotations.readOnlyHint === false) return false;
  return READ_VERB.test(bare);
}

const SQL_GUARD = /^\s*(select|show|describe|with)\b/i;

/** Single read-only statement only: no writes, no multi-statement batches. */
export function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) return false;
  return SQL_GUARD.test(trimmed);
}

/** Throws when a tool execution would violate the read-only policy. */
export function assertReadOnlyExecution(
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
): void {
  if (!isReadOnlyTool(toolName)) {
    throw new Error(`read-only policy: tool "${toolName}" on ${serverName} is not allowed`);
  }
  if (serverName === "snowflake") {
    const sql = String(input.sql ?? input.query ?? "");
    if (sql && !isReadOnlySql(sql)) {
      throw new Error(`read-only policy: only single SELECT/SHOW/DESCRIBE/WITH statements are allowed`);
    }
  }
}

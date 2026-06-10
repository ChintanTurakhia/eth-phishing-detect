import { describe, expect, it } from "vitest";
import { assertReadOnlyExecution, isReadOnlySql, isReadOnlyTool } from "../src/mcp/readonly.js";

describe("isReadOnlyTool", () => {
  const allowed = [
    "list_issues",
    "get_issue",
    "search_code",
    "get_file_contents",
    "list_pull_requests",
    "list_channels",
    "get_channel_history",
    "search_docs",
    "describe_tables",
    "run_query",
    "fetch_page",
    "query_metrics",
  ];
  const denied = [
    "create_issue",
    "update_issue",
    "delete_issue",
    "send_message",
    "post_message",
    "create_pull_request",
    "merge_pull_request",
    "push_files",
    "create_or_update_file",
    "delete_file",
    "execute",
    "write",
    "add_comment",
    "set_status",
    "upload_file",
  ];

  it.each(allowed)("allows %s", (name) => {
    expect(isReadOnlyTool(name)).toBe(true);
  });

  it.each(denied)("denies %s", (name) => {
    expect(isReadOnlyTool(name)).toBe(false);
  });

  it("denies read-named tools annotated as mutating", () => {
    expect(isReadOnlyTool("get_thing", { readOnlyHint: false })).toBe(false);
  });
});

describe("isReadOnlySql", () => {
  it.each([
    "SELECT * FROM t",
    "  select 1",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "SHOW TABLES",
    "DESCRIBE t",
    "select 1;",
  ])("allows %s", (sql) => {
    expect(isReadOnlySql(sql)).toBe(true);
  });

  it.each([
    "DROP TABLE t",
    "DELETE FROM t",
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET x = 1",
    "SELECT 1; DROP TABLE t",
    "CREATE TABLE t (x int)",
    "TRUNCATE t",
  ])("denies %s", (sql) => {
    expect(isReadOnlySql(sql)).toBe(false);
  });
});

describe("assertReadOnlyExecution", () => {
  it("throws on a denied tool even if it slipped past listing", () => {
    expect(() => assertReadOnlyExecution("linear", "create_issue", {})).toThrow(/read-only/);
  });
  it("throws on mutating SQL through run_query", () => {
    expect(() => assertReadOnlyExecution("snowflake", "run_query", { sql: "DROP TABLE x" })).toThrow(
      /read-only/,
    );
  });
  it("passes a clean select", () => {
    expect(() =>
      assertReadOnlyExecution("snowflake", "run_query", { sql: "SELECT * FROM churn" }),
    ).not.toThrow();
  });
});

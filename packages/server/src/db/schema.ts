/** SQLite schema. The DB (WAL mode) is the sim's state of record. */
export const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  soul_path TEXT NOT NULL,
  summary_description TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INTEGER NOT NULL,
  created_at_sim INTEGER NOT NULL,
  last_accessed_sim INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, created_at_sim);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  sim_day INTEGER NOT NULL,
  level TEXT NOT NULL,
  parent_id TEXT,
  description TEXT NOT NULL,
  location_path TEXT,
  start_sim INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  status TEXT NOT NULL,
  is_work INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plans_agent_day ON plans(agent_id, sim_day);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  participants_json TEXT NOT NULL,
  started_sim INTEGER NOT NULL,
  ended_sim INTEGER,
  summary TEXT,
  location TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS utterances (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  sim_time INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_utterances_conv ON utterances(conversation_id, seq);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  grounding_refs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  review_reason TEXT,
  created_sim INTEGER NOT NULL,
  reviewed_at_wall INTEGER
);

CREATE TABLE IF NOT EXISTS world_events (
  id TEXT PRIMARY KEY,
  sim_time INTEGER NOT NULL,
  location_path TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_events_time ON world_events(sim_time);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sim_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  wall_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_day ON llm_usage(day);
`;

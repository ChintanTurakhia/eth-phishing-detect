import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { StorePort } from "@virtual-sim/core";
import type {
  Artifact,
  Conversation,
  Memory,
  PlanItem,
  SimMinutes,
  Utterance,
  WorldEvent,
} from "@virtual-sim/shared";

export class SqliteStore implements StorePort {
  readonly db: Database.Database;

  constructor(path: string, schema: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec(schema);
  }

  // ------------------------------------------------------------- memories

  insertMemory(m: Memory, embedding: Float32Array): void {
    this.db
      .prepare(
        `INSERT INTO memories (id, agent_id, kind, content, importance, created_at_sim, last_accessed_sim, embedding, citations_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.agentId,
        m.kind,
        m.content,
        m.importance,
        m.createdAtSim,
        m.lastAccessedSim,
        Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength),
        JSON.stringify(m.citations),
      );
  }

  touchMemories(ids: string[], lastAccessedSim: SimMinutes): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(`UPDATE memories SET last_accessed_sim = ? WHERE id = ?`);
    const tx = this.db.transaction((rows: string[]) => {
      for (const id of rows) stmt.run(lastAccessedSim, id);
    });
    tx(ids);
  }

  loadMemories(agentId: string): Array<{ memory: Memory; embedding: Float32Array }> {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at_sim ASC`)
      .all(agentId) as Array<{
      id: string;
      agent_id: string;
      kind: Memory["kind"];
      content: string;
      importance: number;
      created_at_sim: number;
      last_accessed_sim: number;
      embedding: Buffer;
      citations_json: string;
    }>;
    return rows.map((r) => ({
      memory: {
        id: r.id,
        agentId: r.agent_id,
        kind: r.kind,
        content: r.content,
        importance: r.importance,
        createdAtSim: r.created_at_sim,
        lastAccessedSim: r.last_accessed_sim,
        citations: JSON.parse(r.citations_json) as string[],
      },
      embedding: new Float32Array(
        r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength),
      ),
    }));
  }

  // ---------------------------------------------------------------- plans

  insertPlanItems(items: PlanItem[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO plans (id, agent_id, sim_day, level, parent_id, description, location_path, start_sim, duration_min, status, is_work)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction((rows: PlanItem[]) => {
      for (const p of rows) {
        stmt.run(
          p.id,
          p.agentId,
          p.simDay,
          p.level,
          p.parentId,
          p.description,
          p.locationPath,
          p.startSim,
          p.durationMin,
          p.status,
          p.isWork ? 1 : 0,
        );
      }
    });
    tx(items);
  }

  updatePlanStatus(id: string, status: PlanItem["status"]): void {
    this.db.prepare(`UPDATE plans SET status = ? WHERE id = ?`).run(status, id);
  }

  abandonPlansFrom(agentId: string, simTime: SimMinutes): void {
    this.db
      .prepare(
        `UPDATE plans SET status = 'abandoned'
         WHERE agent_id = ? AND start_sim + duration_min > ? AND status IN ('pending','active')`,
      )
      .run(agentId, simTime);
  }

  loadPlans(agentId: string, simDay: number): PlanItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM plans WHERE agent_id = ? AND sim_day = ? ORDER BY start_sim ASC`)
      .all(agentId, simDay) as Array<{
      id: string;
      agent_id: string;
      sim_day: number;
      level: PlanItem["level"];
      parent_id: string | null;
      description: string;
      location_path: string | null;
      start_sim: number;
      duration_min: number;
      status: PlanItem["status"];
      is_work: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      simDay: r.sim_day,
      level: r.level,
      parentId: r.parent_id,
      description: r.description,
      locationPath: r.location_path,
      startSim: r.start_sim,
      durationMin: r.duration_min,
      status: r.status,
      isWork: r.is_work === 1,
    }));
  }

  // -------------------------------------------------------- conversations

  insertConversation(c: Conversation): void {
    this.db
      .prepare(
        `INSERT INTO conversations (id, participants_json, started_sim, ended_sim, summary, location)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, JSON.stringify(c.participants), c.startedSim, c.endedSim, c.summary, c.location);
  }

  endConversation(id: string, endedSim: SimMinutes, summary: string): void {
    this.db
      .prepare(`UPDATE conversations SET ended_sim = ?, summary = ? WHERE id = ?`)
      .run(endedSim, summary, id);
  }

  insertUtterance(u: Utterance): void {
    this.db
      .prepare(
        `INSERT INTO utterances (id, conversation_id, agent_id, content, sim_time, seq)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(u.id, u.conversationId, u.agentId, u.content, u.simTime, u.seq);
  }

  listUtterances(conversationId: string): Utterance[] {
    const rows = this.db
      .prepare(`SELECT * FROM utterances WHERE conversation_id = ? ORDER BY seq ASC`)
      .all(conversationId) as Array<{
      id: string;
      conversation_id: string;
      agent_id: string;
      content: string;
      sim_time: number;
      seq: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      agentId: r.agent_id,
      content: r.content,
      simTime: r.sim_time,
      seq: r.seq,
    }));
  }

  recentConversations(limit: number): Conversation[] {
    const rows = this.db
      .prepare(`SELECT * FROM conversations ORDER BY started_sim DESC LIMIT ?`)
      .all(limit) as Array<{
      id: string;
      participants_json: string;
      started_sim: number;
      ended_sim: number | null;
      summary: string | null;
      location: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      participants: JSON.parse(r.participants_json) as string[],
      startedSim: r.started_sim,
      endedSim: r.ended_sim,
      summary: r.summary,
      location: r.location,
    }));
  }

  // ------------------------------------------------------------ artifacts

  insertArtifact(a: Artifact): void {
    this.db
      .prepare(
        `INSERT INTO artifacts (id, agent_id, type, title, body, payload_json, grounding_refs_json, status, review_reason, created_sim, reviewed_at_wall)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.agentId,
        a.type,
        a.title,
        a.body,
        JSON.stringify(a.payload),
        JSON.stringify(a.groundingRefs),
        a.status,
        a.reviewReason,
        a.createdSim,
        a.reviewedAtWall,
      );
  }

  reviewArtifact(id: string, status: "accepted" | "rejected", reason: string): Artifact | null {
    this.db
      .prepare(`UPDATE artifacts SET status = ?, review_reason = ?, reviewed_at_wall = ? WHERE id = ?`)
      .run(status, reason, Date.now(), id);
    return this.getArtifact(id);
  }

  getArtifact(id: string): Artifact | null {
    const r = this.db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as
      | ArtifactRow
      | undefined;
    return r ? rowToArtifact(r) : null;
  }

  listArtifacts(status?: string): Artifact[] {
    const rows = (
      status
        ? this.db.prepare(`SELECT * FROM artifacts WHERE status = ? ORDER BY created_sim DESC`).all(status)
        : this.db.prepare(`SELECT * FROM artifacts ORDER BY created_sim DESC`).all()
    ) as ArtifactRow[];
    return rows.map(rowToArtifact);
  }

  // ----------------------------------------------------------- world etc.

  insertWorldEvent(e: WorldEvent): void {
    this.db
      .prepare(
        `INSERT INTO world_events (id, sim_time, location_path, subject, predicate, object, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.id, e.simTime, e.locationPath, e.subject, e.predicate, e.object, e.description);
  }

  recentWorldEvents(limit: number): WorldEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM world_events ORDER BY sim_time DESC LIMIT ?`)
      .all(limit) as Array<{
      id: string;
      sim_time: number;
      location_path: string;
      subject: string;
      predicate: string;
      object: string;
      description: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      simTime: r.sim_time,
      locationPath: r.location_path,
      subject: r.subject,
      predicate: r.predicate,
      object: r.object,
      description: r.description,
    }));
  }

  // --------------------------------------------------------------- agents

  upsertAgent(args: { id: string; name: string; soulPath: string; summary: string; stateJson: string }): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, soul_path, summary_description, state_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, soul_path = excluded.soul_path,
           summary_description = excluded.summary_description, state_json = excluded.state_json`,
      )
      .run(args.id, args.name, args.soulPath, args.summary, args.stateJson, Date.now());
  }

  deleteAgent(id: string): void {
    this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
  }

  listAgents(): Array<{ id: string; name: string; soulPath: string; summary: string; stateJson: string }> {
    const rows = this.db.prepare(`SELECT * FROM agents`).all() as Array<{
      id: string;
      name: string;
      soul_path: string;
      summary_description: string;
      state_json: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      soulPath: r.soul_path,
      summary: r.summary_description,
      stateJson: r.state_json,
    }));
  }

  saveAgentState(agentId: string, stateJson: string): void {
    this.db.prepare(`UPDATE agents SET state_json = ? WHERE id = ?`).run(stateJson, agentId);
  }

  saveAgentSummary(agentId: string, summary: string): void {
    this.db.prepare(`UPDATE agents SET summary_description = ? WHERE id = ?`).run(summary, agentId);
  }

  // --------------------------------------------------- sim state/settings

  setSimState(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO sim_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  getSimState(key: string): string | null {
    const r = this.db.prepare(`SELECT value FROM sim_state WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return r?.value ?? null;
  }

  setSetting(key: string, valueJson: string): void {
    this.db
      .prepare(`INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`)
      .run(key, valueJson);
  }

  getSetting(key: string): string | null {
    const r = this.db.prepare(`SELECT value_json FROM settings WHERE key = ?`).get(key) as
      | { value_json: string }
      | undefined;
    return r?.value_json ?? null;
  }

  // ------------------------------------------------------------ llm usage

  recordUsage(args: {
    day: string;
    model: string;
    purpose: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO llm_usage (day, model, purpose, input_tokens, output_tokens, cache_read_tokens, wall_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(args.day, args.model, args.purpose, args.inputTokens, args.outputTokens, args.cacheReadTokens, Date.now());
  }

  usageForDay(day: string): { inputTokens: number; outputTokens: number; cacheReadTokens: number } {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cache_read_tokens),0) AS c
         FROM llm_usage WHERE day = ?`,
      )
      .get(day) as { i: number; o: number; c: number };
    return { inputTokens: r.i, outputTokens: r.o, cacheReadTokens: r.c };
  }
}

interface ArtifactRow {
  id: string;
  agent_id: string;
  type: Artifact["type"];
  title: string;
  body: string;
  payload_json: string;
  grounding_refs_json: string;
  status: Artifact["status"];
  review_reason: string | null;
  created_sim: number;
  reviewed_at_wall: number | null;
}

function rowToArtifact(r: ArtifactRow): Artifact {
  return {
    id: r.id,
    agentId: r.agent_id,
    type: r.type,
    title: r.title,
    body: r.body,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    groundingRefs: JSON.parse(r.grounding_refs_json) as string[],
    status: r.status,
    reviewReason: r.review_reason,
    createdSim: r.created_sim,
    reviewedAtWall: r.reviewed_at_wall,
  };
}

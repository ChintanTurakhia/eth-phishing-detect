"use client";

import { useEffect, useState } from "react";
import { formatSimTime, type Memory, type PlanItem, type RetrievalScore } from "@virtual-sim/shared";
import { useSim } from "@/lib/store";

type Tab = "memories" | "plan" | "soul";

export function AgentDrawer({ agentId }: { agentId: string }) {
  const agent = useSim((s) => s.agents.get(agentId));
  const select = useSim((s) => s.select);
  const [tab, setTab] = useState<Tab>("memories");

  if (!agent) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={() => select(null)} />
      <div className="drawer">
        <div className="head">
          <div className="avatar" style={{ background: agent.color, width: 44, height: 44 }}>
            {agent.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{agent.name}</div>
            <div style={{ color: "var(--text-faint)", fontSize: 12 }}>
              {agent.role === "pm" ? "Product Manager" : agent.role} · {agent.team} · {agent.state.statusEmoji}{" "}
              {agent.state.currentAction ?? agent.state.status}
            </div>
          </div>
          <button className="btn small" style={{ marginLeft: "auto" }} onClick={() => select(null)}>
            ✕
          </button>
        </div>
        <div className="tabs">
          {(["memories", "plan", "soul"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="body">
          {tab === "memories" && <MemoryInspector agentId={agentId} />}
          {tab === "plan" && <PlanViewer agentId={agentId} />}
          {tab === "soul" && (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6, color: "var(--text-dim)" }}>
              {agent.summaryDescription}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}

function MemoryRow({ m, score }: { m: Memory; score?: RetrievalScore }) {
  return (
    <div className="memory-item">
      <div className="meta">
        <span className={`kind-chip kind-${m.kind}`}>{m.kind}</span>
        <span>{formatSimTime(m.createdAtSim)}</span>
        <span className="imp-bar" title={`importance ${m.importance}/10`}>
          <i style={{ width: `${m.importance * 10}%` }} />
        </span>
        {score && (
          <span className="score-chips">
            <span title="recency">r {score.recency.toFixed(2)}</span>
            <span title="importance">i {score.importance.toFixed(2)}</span>
            <span title="relevance">v {score.relevance.toFixed(2)}</span>
            <span title="total">Σ {score.total.toFixed(2)}</span>
          </span>
        )}
      </div>
      <div>{m.content}</div>
      {m.citations.length > 0 && (
        <div className="meta" style={{ marginTop: 4 }}>
          cites: {m.citations.join(", ")}
        </div>
      )}
    </div>
  );
}

function MemoryInspector({ agentId }: { agentId: string }) {
  const live = useSim((s) => s.memories.get(agentId)) ?? [];
  const [loaded, setLoaded] = useState<Memory[]>([]);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ memory: Memory; score: RetrievalScore }> | null>(null);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/memories?limit=200${kind ? `&kind=${kind}` : ""}`)
      .then((r) => r.json())
      .then((d: { memories: Memory[] }) => setLoaded(d.memories))
      .catch(() => setLoaded([]));
  }, [agentId, kind, live.length]);

  const search = async () => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const r = await fetch(`/api/agents/${agentId}/retrieve?q=${encodeURIComponent(query)}`);
    const d = (await r.json()) as { results: Array<{ memory: Memory; score: RetrievalScore }> };
    setResults(d.results);
  };

  return (
    <div>
      <div className="search-row">
        <input
          placeholder="Run retrieval (recency + importance + relevance)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">all kinds</option>
          <option value="observation">observation</option>
          <option value="reflection">reflection</option>
          <option value="plan">plan</option>
          <option value="dialogue">dialogue</option>
        </select>
        <button className="btn" onClick={() => void search()}>
          Retrieve
        </button>
      </div>
      {results ? (
        <>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8 }}>
            top {results.length} by retrieval score —{" "}
            <a style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => setResults(null)}>
              back to stream
            </a>
          </div>
          {results.map((r) => (
            <MemoryRow key={r.memory.id} m={r.memory} score={r.score} />
          ))}
        </>
      ) : (
        <>
          {loaded.map((m) => (
            <MemoryRow key={m.id} m={m} />
          ))}
          {loaded.length === 0 && <div className="empty">No memories yet.</div>}
        </>
      )}
    </div>
  );
}

function PlanViewer({ agentId }: { agentId: string }) {
  const livePlans = useSim((s) => s.plans.get(agentId));
  const simTime = useSim((s) => s.sim.simTime);
  const [items, setItems] = useState<PlanItem[]>([]);

  useEffect(() => {
    if (livePlans) {
      setItems(livePlans);
      return;
    }
    fetch(`/api/agents/${agentId}/plans`)
      .then((r) => r.json())
      .then((d: { items: PlanItem[] }) => setItems(d.items))
      .catch(() => setItems([]));
  }, [agentId, livePlans]);

  const chunks = items.filter((p) => p.level === "day").sort((a, b) => a.startSim - b.startSim);
  const actions = items.filter((p) => p.level === "action");
  const orphans = actions.filter((a) => !chunks.some((c) => c.id === a.parentId));

  const fmt = (t: number) => formatSimTime(t).split(" ").slice(1).join(" ");

  const renderAction = (a: PlanItem) => {
    const current = a.startSim <= simTime && simTime < a.startSim + a.durationMin && a.status !== "abandoned";
    return (
      <div key={a.id} className={`plan-action ${current ? "active" : a.status}`}>
        <span className="time">{fmt(a.startSim)}</span>
        <span>
          {current ? "▶ " : ""}
          {a.description}
        </span>
        {a.isWork && <span className="work-chip">work</span>}
      </div>
    );
  };

  return (
    <div>
      {chunks.map((c) => (
        <div key={c.id} className="plan-chunk">
          <div className="head">
            <span className="time">
              {fmt(c.startSim)}–{fmt(c.startSim + c.durationMin)}
            </span>
            <span>{c.description}</span>
            {c.isWork && <span className="work-chip">work</span>}
          </div>
          {actions
            .filter((a) => a.parentId === c.id)
            .sort((a, b) => a.startSim - b.startSim)
            .map(renderAction)}
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="plan-chunk">
          <div className="head">
            <span>Reactions / unplanned</span>
          </div>
          {orphans.sort((a, b) => a.startSim - b.startSim).map(renderAction)}
        </div>
      )}
      {items.length === 0 && <div className="empty">No plan yet — the agent plans at wake-up.</div>}
    </div>
  );
}

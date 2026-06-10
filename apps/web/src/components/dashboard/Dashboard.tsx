"use client";

import { formatSimTime } from "@virtual-sim/shared";
import { useSim } from "@/lib/store";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

export function Dashboard() {
  const agents = useSim((s) => s.agents);
  const select = useSim((s) => s.select);

  return (
    <div className="dashboard">
      <div className="dash-left">
        <div className="panel" style={{ flexShrink: 0 }}>
          <div className="panel-title">Team</div>
          <div className="panel-body">
            <div className="agent-grid">
              {[...agents.values()].map((a) => (
                <div
                  key={a.id}
                  className="agent-card"
                  style={{ "--agent-color": a.color } as React.CSSProperties}
                  onClick={() => select(a.id)}
                >
                  <div className="head">
                    <div className="avatar" style={{ background: a.color }}>
                      {initials(a.name)}
                    </div>
                    <div>
                      <div className="name">{a.name}</div>
                      <div className="role">
                        {a.role === "pm" ? "Product Manager" : a.role} · {a.team}
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", fontSize: 20 }}>{a.state.statusEmoji}</div>
                  </div>
                  <div className="status">
                    <span>{a.state.currentAction ?? a.state.status}</span>
                  </div>
                  <div className="loc">📍 {a.state.location.split(".").slice(1).join(" / ") || a.state.location}</div>
                </div>
              ))}
              {agents.size === 0 && <div className="empty">Waiting for the simulation server…</div>}
            </div>
          </div>
        </div>

        <ActivityTimeline />
      </div>

      <div className="dash-right">
        <ConversationPanel />
      </div>
    </div>
  );
}

function ActivityTimeline() {
  const events = useSim((s) => s.events);
  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-title">
        Activity
        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{events.length} events</span>
      </div>
      <div className="panel-body">
        {events.map((e) => (
          <div key={e.id} className="timeline-item">
            <span className="t">{formatSimTime(e.simTime)}</span>
            <span className="d">{e.description}</span>
          </div>
        ))}
        {events.length === 0 && <div className="empty">No activity yet — press Play.</div>}
      </div>
    </div>
  );
}

function ConversationPanel() {
  const conversations = useSim((s) => s.conversations);
  const utterances = useSim((s) => s.utterances);
  const agents = useSim((s) => s.agents);

  const list = [...conversations.values()].sort((a, b) => b.startedSim - a.startedSim);

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-title">Conversations</div>
      <div className="panel-body">
        {list.map((c) => {
          const names = c.participants.map((p) => agents.get(p)?.name ?? p).join(" ↔ ");
          const turns = utterances.get(c.id) ?? [];
          return (
            <div key={c.id} className="convo">
              <div className="meta">
                {names} · {formatSimTime(c.startedSim)}
                {c.endedSim != null ? " · ended" : " · live"}
              </div>
              {turns.map((u) => {
                const speaker = agents.get(u.agentId);
                return (
                  <div key={u.id} className="bubble">
                    <div className="speaker" style={{ color: speaker?.color }}>
                      {u.agentName}
                    </div>
                    <div className="text">{u.content}</div>
                  </div>
                );
              })}
              {c.summary && <div className="summary">→ {c.summary}</div>}
            </div>
          );
        })}
        {list.length === 0 && <div className="empty">No conversations yet. Agents talk when their paths cross.</div>}
      </div>
    </div>
  );
}

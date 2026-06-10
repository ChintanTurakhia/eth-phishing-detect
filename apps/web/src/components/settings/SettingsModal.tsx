"use client";

import { useEffect, useState } from "react";
import type { SimSettings } from "@virtual-sim/shared";
import { useSim } from "@/lib/store";
import { send } from "@/lib/ws";

type Tab = "simulation" | "models" | "mcp" | "agents";

export function SettingsModal() {
  const toggleSettings = useSim((s) => s.toggleSettings);
  const settings = useSim((s) => s.settings);
  const mcp = useSim((s) => s.mcp);
  const [tab, setTab] = useState<Tab>("simulation");
  const [draft, setDraft] = useState<SimSettings | null>(settings);

  useEffect(() => setDraft(settings), [settings]);

  if (!draft) return null;

  const patch = (p: Partial<SimSettings>) => setDraft({ ...draft, ...p });
  const save = () => {
    send({ type: "settings.update", payload: { patch: draft } });
    toggleSettings(false);
  };

  return (
    <div className="modal-overlay" onClick={() => toggleSettings(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title" style={{ padding: "14px 16px" }}>
          Settings
          <button className="btn small" onClick={() => toggleSettings(false)}>
            ✕
          </button>
        </div>
        <div className="tabs" style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {(["simulation", "models", "mcp", "agents"] as Tab[]).map((t) => (
            <button
              key={t}
              className="btn small"
              style={{
                border: "none",
                borderRadius: 0,
                background: "transparent",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t ? "var(--text)" : "var(--text-dim)",
                padding: "10px 16px",
              }}
              onClick={() => setTab(t)}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          {tab === "simulation" && (
            <div className="settings-grid">
              <Num label="Speed (sim-min / sec)" value={draft.speed} onChange={(v) => patch({ speed: v })} />
              <Num
                label="Reflection threshold"
                value={draft.reflectionThreshold}
                onChange={(v) => patch({ reflectionThreshold: v })}
              />
              <Num label="Retrieval top-k" value={draft.retrievalTopK} onChange={(v) => patch({ retrievalTopK: v })} />
              <Num
                label="React gate (min importance)"
                value={draft.reactGateImportance}
                onChange={(v) => patch({ reactGateImportance: v })}
              />
              <Num
                label="Recency weight"
                value={draft.retrievalWeights.recency}
                step={0.1}
                onChange={(v) => patch({ retrievalWeights: { ...draft.retrievalWeights, recency: v } })}
              />
              <Num
                label="Importance weight"
                value={draft.retrievalWeights.importance}
                step={0.1}
                onChange={(v) => patch({ retrievalWeights: { ...draft.retrievalWeights, importance: v } })}
              />
              <Num
                label="Relevance weight"
                value={draft.retrievalWeights.relevance}
                step={0.1}
                onChange={(v) => patch({ retrievalWeights: { ...draft.retrievalWeights, relevance: v } })}
              />
              <Num
                label="Dialogue max turns"
                value={draft.dialogueMaxTurns}
                onChange={(v) => patch({ dialogueMaxTurns: v })}
              />
            </div>
          )}
          {tab === "models" && (
            <div className="settings-grid">
              <Text label="Cognition model" value={draft.cognitionModel} onChange={(v) => patch({ cognitionModel: v })} />
              <Text label="Utility model" value={draft.utilityModel} onChange={(v) => patch({ utilityModel: v })} />
              <Num
                label="Daily token budget (0 = unlimited)"
                value={draft.dailyTokenBudget}
                onChange={(v) => patch({ dailyTokenBudget: v })}
              />
              <Num label="LLM concurrency" value={draft.llmConcurrency} onChange={(v) => patch({ llmConcurrency: v })} />
              <div className="field">
                <label>Adaptive thinking</label>
                <select
                  value={draft.adaptiveThinking ? "on" : "off"}
                  onChange={(e) => patch({ adaptiveThinking: e.target.value === "on" })}
                >
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </div>
            </div>
          )}
          {tab === "mcp" && (
            <div>
              <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 0 }}>
                All connections are <b>read-only</b>; writes become review-queue artifacts. Unconfigured servers fall
                back to bundled mock fixtures.
              </p>
              {(Object.keys(draft.mcp) as Array<keyof SimSettings["mcp"]>).map((name) => {
                const status = mcp.find((m) => m.name === name);
                const cfg = draft.mcp[name];
                return (
                  <div key={name} className="mcp-row">
                    <span className="name">{name}</span>
                    <span className={`mode-chip mode-${status?.mode ?? "mock"}`}>{status?.mode ?? "mock"}</span>
                    <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{status?.toolCount ?? 0} tools</span>
                    <input
                      style={{ flex: 1 }}
                      placeholder="MCP server URL (Streamable HTTP) — blank = mock"
                      value={cfg.url}
                      onChange={(e) =>
                        patch({ mcp: { ...draft.mcp, [name]: { ...cfg, url: e.target.value } } })
                      }
                    />
                    {status?.error && (
                      <span style={{ fontSize: 10, color: "var(--warn)" }} title={status.error}>
                        ⚠
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {tab === "agents" && <AgentsTab />}
        </div>
        <div style={{ padding: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={() => toggleSettings(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AgentsTab() {
  const agents = useSim((s) => s.agents);
  const [souls, setSouls] = useState<Array<{ fileName: string; content: string }>>([]);
  const [editing, setEditing] = useState<{ fileName: string; content: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/souls")
      .then((r) => r.json())
      .then((d: { souls: Array<{ fileName: string; content: string }> }) => setSouls(d.souls))
      .catch(() => setSouls([]));
  }, [agents.size]);

  const save = async () => {
    if (!editing) return;
    const r = await fetch("/api/souls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editing),
    });
    if (!r.ok) {
      const d = (await r.json()) as { error?: string };
      setError(d.error ?? "save failed");
      return;
    }
    setError("");
    setEditing(null);
  };

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={editing.fileName}
            onChange={(e) => setEditing({ ...editing, fileName: e.target.value })}
            style={{ width: 240, fontFamily: "var(--mono)" }}
          />
          <button className="btn primary small" onClick={() => void save()}>
            Save soul
          </button>
          <button className="btn small" onClick={() => setEditing(null)}>
            Back
          </button>
          {error && <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
        </div>
        <textarea
          style={{ flex: 1, minHeight: 320 }}
          value={editing.content}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
        />
      </div>
    );
  }

  return (
    <div>
      {souls.map((s) => {
        const agent = [...agents.values()].find((a) => s.fileName.startsWith(a.id.replace("agent_", "")));
        return (
          <div key={s.fileName} className="mcp-row">
            <span className="name" style={{ width: 160, textTransform: "none", fontFamily: "var(--mono)", fontSize: 12 }}>
              {s.fileName}
            </span>
            <span style={{ flex: 1, fontSize: 12, color: "var(--text-dim)" }}>{agent?.name ?? ""}</span>
            <button className="btn small" onClick={() => setEditing(s)}>
              Edit
            </button>
            {agent && (
              <button className="btn small danger" onClick={() => send({ type: "agent.remove", payload: { agentId: agent.id } })}>
                Remove
              </button>
            )}
          </div>
        );
      })}
      <button
        className="btn"
        style={{ marginTop: 8 }}
        onClick={() =>
          setEditing({
            fileName: "newagent.soul.md",
            content: `---\nname: New Agent\nrole: engineer\nteam: Core\ndesk: office.bullpen.desk-ada\navatar: new\ncolor: "#888888"\nwakeHour: 8\nsleepHour: 19\n---\n\n# Identity\n…\n\n# Personality\n…\n\n# Expertise\n…\n\n# Values\n…\n\n# Quirks\n…\n`,
          })
        }
      >
        + New soul
      </button>
      <p style={{ fontSize: 11, color: "var(--text-faint)" }}>
        New souls are picked up on server restart; edits to existing souls hot-reload.
      </p>
    </div>
  );
}

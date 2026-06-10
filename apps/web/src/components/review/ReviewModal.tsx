"use client";

import { useEffect, useState } from "react";
import { formatSimTime, type Artifact } from "@virtual-sim/shared";
import { useSim } from "@/lib/store";
import { send } from "@/lib/ws";

export function ReviewModal() {
  const toggleReview = useSim((s) => s.toggleReview);
  const agents = useSim((s) => s.agents);
  const liveArtifacts = useSim((s) => s.artifacts);
  const [all, setAll] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    fetch("/api/artifacts")
      .then((r) => r.json())
      .then((d: { artifacts: Artifact[] }) => setAll(d.artifacts))
      .catch(() => setAll([]));
  }, [liveArtifacts]);

  const review = (decision: "accepted" | "rejected") => {
    if (!selected) return;
    send({ type: "artifact.review", payload: { id: selected.id, decision, reason } });
    setSelected(null);
    setReason("");
  };

  const agentName = (id: string) => agents.get(id)?.name ?? id;

  return (
    <div className="modal-overlay" onClick={() => toggleReview(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title" style={{ padding: "14px 16px" }}>
          Review queue
          <button className="btn small" onClick={() => toggleReview(false)}>
            ✕
          </button>
        </div>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 280, borderRight: "1px solid var(--border)", overflowY: "auto", padding: 10 }}>
            {all.map((a) => (
              <div key={a.id} className="artifact-row" onClick={() => setSelected(a)}>
                <div className="title">{a.title}</div>
                <div className="meta">
                  <span className="type-chip">{a.type.replace("_", " ")}</span>
                  <span className={`status-${a.status}`}>{a.status}</span>
                </div>
                <div className="meta">
                  {agentName(a.agentId)} · {formatSimTime(a.createdSim)}
                </div>
              </div>
            ))}
            {all.length === 0 && <div className="empty">Nothing to review yet. Agents submit work here.</div>}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }} className="artifact-detail">
            {selected ? (
              <>
                <h3 style={{ margin: "0 0 4px" }}>{selected.title}</h3>
                <div className="meta" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  by {agentName(selected.agentId)} · <span className={`status-${selected.status}`}>{selected.status}</span>
                  {selected.reviewReason ? ` — "${selected.reviewReason}"` : ""}
                </div>
                <div className="md">{selected.body}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", fontWeight: 700 }}>
                  Grounding
                </div>
                <div className="grounding">
                  {selected.groundingRefs.map((g, i) => (
                    <span key={i}>{g}</span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", fontWeight: 700 }}>
                  Payload (future write)
                </div>
                <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
                {selected.status === "pending" && (
                  <div className="review-actions">
                    <textarea
                      placeholder="Reason (required for reject; fed back into the agent's memory)…"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <button className="btn primary" onClick={() => review("accepted")}>
                        ✓ Accept
                      </button>
                      <button className="btn danger" disabled={!reason.trim()} onClick={() => review("rejected")}>
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty">Select an artifact to review. Your decision and reason go straight into the agent&apos;s memory.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { formatSimTime, toSimDateTime } from "@virtual-sim/shared";
import { useSim } from "@/lib/store";
import { send } from "@/lib/ws";

function dayIcon(hour: number): string {
  if (hour < 7 || hour >= 21) return "🌙";
  if (hour < 9) return "🌅";
  if (hour >= 17) return "🌇";
  return "☀️";
}

export function TopBar() {
  const { view, setView, sim, budget, artifacts, connected, toggleReview, toggleSettings } = useSim();
  const pending = artifacts.filter((a) => a.status === "pending").length;
  const { hour } = toSimDateTime(sim.simTime);

  const used = budget ? budget.inputTokens + budget.outputTokens : 0;
  const pct = budget && budget.budgetTokens > 0 ? Math.min(100, (used / budget.budgetTokens) * 100) : 0;

  return (
    <header className="topbar">
      <span className="brand">VIRTUAL-SIM</span>
      <span className={`conn-dot ${connected ? "on" : ""}`} title={connected ? "connected" : "disconnected"} />

      <div className="view-toggle">
        <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
          Dashboard
        </button>
        <button className={view === "office" ? "active" : ""} onClick={() => setView("office")}>
          Office
        </button>
      </div>

      <div className="clock">
        <span>{dayIcon(hour)}</span>
        <span>{formatSimTime(sim.simTime)}</span>
      </div>

      <div className="controls">
        {sim.state === "running" ? (
          <button className="btn" onClick={() => send({ type: "sim.pause" })}>
            ⏸ Pause
          </button>
        ) : (
          <button className="btn primary" onClick={() => send({ type: "sim.start" })}>
            ▶ Play
          </button>
        )}
        <div className="speed">
          <input
            type="range"
            min={1}
            max={300}
            value={sim.speed}
            onChange={(e) => send({ type: "sim.setSpeed", payload: { speed: Number(e.target.value) } })}
          />
          <span>{sim.speed}×</span>
        </div>
      </div>

      <div className="spacer" />

      {budget && budget.budgetTokens > 0 && (
        <div className="budget-meter" title={`${used.toLocaleString()} / ${budget.budgetTokens.toLocaleString()} tokens today`}>
          <div className="label">
            <span>tokens</span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div className="bar">
            <div className={`fill ${pct > 100 ? "over" : pct > 80 ? "hot" : ""}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      )}

      <button className="btn badge" data-count={pending} onClick={() => toggleReview()}>
        📋 Review
      </button>
      <button className="btn" onClick={() => toggleSettings()}>
        ⚙️
      </button>
    </header>
  );
}

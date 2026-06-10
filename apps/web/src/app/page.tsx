"use client";

import dynamic from "next/dynamic";
import { useSim } from "@/lib/store";
import { useSimSocket } from "@/lib/ws";
import { TopBar } from "@/components/TopBar";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { AgentDrawer } from "@/components/dashboard/AgentDrawer";
import { ReviewModal } from "@/components/review/ReviewModal";
import { SettingsModal } from "@/components/settings/SettingsModal";

const OfficeView = dynamic(
  () => import("@/components/office/OfficeView").then((m) => m.OfficeView),
  { ssr: false },
);

export default function Home() {
  useSimSocket();
  const view = useSim((s) => s.view);
  const selectedAgentId = useSim((s) => s.selectedAgentId);
  const showSettings = useSim((s) => s.showSettings);
  const showReview = useSim((s) => s.showReview);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        {view === "dashboard" ? <Dashboard /> : <OfficeView />}
        {selectedAgentId && <AgentDrawer agentId={selectedAgentId} />}
      </div>
      {showReview && <ReviewModal />}
      {showSettings && <SettingsModal />}
    </div>
  );
}

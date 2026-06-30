"use client";

import { useState } from "react";
import Login from "../components/Login";
import AppShell from "../components/AppShell";
import { getLiveMonitorRange } from "../lib/dateRange";
import type { LiveMonitorDataset } from "../lib/data";
import { preloadDefaultReports } from "../lib/useReportData";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [initialLiveData, setInitialLiveData] = useState<LiveMonitorDataset | null>(null);

  if (!isLoggedIn) {
    return (
      <Login
        onLogin={async () => {
          const range = getLiveMonitorRange();
          const query = new URLSearchParams({ from: range.start, to: range.end });
          const liveRequest = fetch(`/api/wialon/live-monitor?${query.toString()}`, { cache: "no-store" });
          const reportsRequest = preloadDefaultReports();
          const res = await liveRequest;
          if (!res.ok) {
            await reportsRequest.catch(() => undefined);
            let details = "";
            try {
              const errPayload = (await res.json()) as { error?: string };
              details = errPayload?.error ? `: ${errPayload.error}` : "";
            } catch {
              details = "";
            }
            throw new Error(`Track3 Database request failed (${res.status})${details}`);
          }
          const payload = (await res.json()) as LiveMonitorDataset;
          await reportsRequest;
          setInitialLiveData(payload);
          setIsLoggedIn(true);
        }}
      />
    );
  }

  return (
    <AppShell
      initialLiveData={initialLiveData}
      onLogout={() => {
        setIsLoggedIn(false);
        setInitialLiveData(null);
      }}
    />
  );
}

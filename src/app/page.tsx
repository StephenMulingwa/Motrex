"use client";

import { useState } from "react";
import Login from "../components/Login";
import AppShell from "../components/AppShell";
import { getLiveMonitorRange } from "../lib/dateRange";
import type { LiveMonitorDataset } from "../lib/data";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [initialLiveData, setInitialLiveData] = useState<LiveMonitorDataset | null>(null);

  if (!isLoggedIn) {
    return (
      <Login
        onLogin={async () => {
          const range = getLiveMonitorRange();
          const query = new URLSearchParams({ from: range.start, to: range.end });
          const res = await fetch(`/api/wialon/live-monitor?${query.toString()}`, { cache: "no-store" });
          if (!res.ok) {
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

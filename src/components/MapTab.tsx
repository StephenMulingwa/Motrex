"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import PageHeader from "./PageHeader";
import type { LiveMonitorDataset } from "@/lib/data";
import type { FleetMapUnit } from "./FleetMapInner";
import { registrationLabel } from "@/lib/vehicleLabels";

const FleetMapInner = dynamic(() => import("./FleetMapInner"), {
  ssr: false,
  loading: () => null,
});

interface MapTabProps {
  data: LiveMonitorDataset | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export default function MapTab({ data, loading, error, onRefresh }: MapTabProps) {
  const [statusFilter, setStatusFilter] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");

  const mapUnits = useMemo((): FleetMapUnit[] => {
    const seen = new Set<string>();
    const units: FleetMapUnit[] = [];

    for (const row of data?.rows ?? []) {
      if (row.lat == null || row.lon == null) continue;
      const id = `${row.vehicle}-${row.lat}-${row.lon}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const registrationNumber = registrationLabel(row.vehicle);
      units.push({
        id,
        registrationNumber,
        location: row.currentLocation || "Unknown",
        lastSeen: row.lastUpdate || "N/A",
        speedKmh: row.speedKmh,
        status: row.status,
        statusCategory: row.statusCategory,
        lat: row.lat,
        lon: row.lon,
      });
    }

    return units.sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber));
  }, [data?.rows]);

  const filteredUnits = useMemo(() => {
    const query = vehicleSearch.trim().toLowerCase();
    return mapUnits.filter((unit) => {
      if (query && !unit.registrationNumber.toLowerCase().includes(query)) return false;
      if (statusFilter && unit.statusCategory !== statusFilter) return false;
      return true;
    });
  }, [mapUnits, statusFilter, vehicleSearch]);

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
      <PageHeader
        title="Fleet"
        titleAccent="Map"
        subtitle="Live fleet positions with vehicle markers shown by default"
        right={
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "#1a1200",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        }
      />
      {error && (
        <p style={{ color: "var(--red)", marginBottom: 12, fontSize: ".82rem", fontWeight: 600 }}>{error}</p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search registration..."
          value={vehicleSearch}
          onChange={(e) => setVehicleSearch(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 220 }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
        >
          <option value="">All status</option>
          <option value="moving">Moving</option>
          <option value="stationary">Stationary</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>
      <FleetMapInner units={filteredUnits} />
    </div>
  );
}

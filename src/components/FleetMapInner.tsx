"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type FleetMapUnit = {
  id: string;
  registrationNumber: string;
  location: string;
  lastSeen: string;
  speedKmh: number;
  status: string;
  lat: number;
  lon: number;
};

type FleetMapInnerProps = {
  units: FleetMapUnit[];
};

const DEFAULT_CENTER: [number, number] = [-1.286389, 36.817223];

function markerColors(unit: FleetMapUnit) {
  const moving = unit.speedKmh > 0;
  return {
    color: moving ? "#067a46" : "#9f1239",
    fillColor: moving ? "#16a34a" : "#dc2626",
  };
}

function FitBounds({ units }: { units: { lat: number; lon: number }[] }) {
  const map = useMap();

  useEffect(() => {
    if (!units.length) return;
    const bounds = L.latLngBounds(units.map((u) => [u.lat, u.lon] as [number, number]));
    map.fitBounds(bounds.pad(0.18));
  }, [map, units]);

  return null;
}

function MapReady() {
  const map = useMap();

  useEffect(() => {
    const timers = [0, 150, 500].map((delay) =>
      window.setTimeout(() => {
        map.invalidateSize();
      }, delay),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [map]);

  return null;
}

export default function FleetMapInner({ units }: FleetMapInnerProps) {
  const center = useMemo(() => {
    if (!units.length) return DEFAULT_CENTER;
    const lat = units.reduce((sum, u) => sum + u.lat, 0) / units.length;
    const lon = units.reduce((sum, u) => sum + u.lon, 0) / units.length;
    return [lat, lon] as [number, number];
  }, [units]);
  const showPermanentLabels = units.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <p style={{ margin: 0, fontSize: ".86rem", color: "var(--text2)", fontWeight: 500, maxWidth: 620 }}>
          Live positions from SM_Motrex_Online Status. Tap or hover a dot for the registration and full details.
        </p>
        <span
          style={{
            fontFamily: "var(--font-head)",
            fontSize: ".72rem",
            fontWeight: 700,
            color: "var(--text)",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "5px 12px",
          }}
        >
          {units.length} vehicle{units.length === 1 ? "" : "s"} on map
        </span>
      </div>

      <div
        style={{
          overflow: "hidden",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow)",
          background: "var(--surface)",
        }}
      >
        <MapContainer
          center={center}
          zoom={units.length ? 8 : 6}
          style={{ height: "min(62vh, 620px)", minHeight: 420, width: "100%", zIndex: 0 }}
          preferCanvas
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapReady />
          <FitBounds units={units} />
          {units.map((unit) => {
            const colors = markerColors(unit);
            return (
              <CircleMarker
                key={unit.id}
                center={[unit.lat, unit.lon]}
                radius={8}
                pathOptions={{
                  color: colors.color,
                  weight: 2,
                  fillColor: colors.fillColor,
                  fillOpacity: 0.92,
                }}
              >
                <Tooltip permanent={showPermanentLabels} direction="right" offset={[10, 0]} className="fleet-map-label">
                  {unit.registrationNumber}
                </Tooltip>
                <Popup>
                  <div style={{ fontFamily: "Arial, sans-serif", fontSize: 13, lineHeight: 1.45, color: "#11284d" }}>
                    <strong style={{ color: colors.color }}>{unit.registrationNumber}</strong>
                    <br />
                    <span>{unit.status}</span>
                    <br />
                    <span>{unit.speedKmh} km/h</span>
                    <br />
                    <span style={{ color: "#4d6488" }}>{unit.location || "Unknown location"}</span>
                    <br />
                    <span style={{ fontSize: 12, color: "#4d6488" }}>Last update: {unit.lastSeen}</span>
                    <br />
                    <a
                      href={`https://www.google.com/maps?q=${encodeURIComponent(`${unit.lat},${unit.lon}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#2f6fed", fontWeight: 700 }}
                    >
                      Open in Google Maps
                    </a>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

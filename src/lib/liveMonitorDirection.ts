import type { LiveMonitorDirection } from "@/lib/data";
import type { LiveMonitorRow } from "@/lib/data";
import { findGeofenceFromText, resolveGeofence } from "@/lib/motrexGeofences";

const LAT_THRESHOLD = 0.0003;

export interface PreviousPosition {
  lat: number;
  lon: number;
  savedAtMs: number;
}

export const PREVIOUS_POSITIONS_STORAGE_KEY = "motrex-live-prev-positions";

export function loadPreviousPositionsFromStorage(): Map<string, PreviousPosition> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = sessionStorage.getItem(PREVIOUS_POSITIONS_STORAGE_KEY);
    if (!raw) return new Map();
    const entries = JSON.parse(raw) as [string, PreviousPosition][];
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function savePreviousPositionsToStorage(positions: Map<string, PreviousPosition>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PREVIOUS_POSITIONS_STORAGE_KEY, JSON.stringify([...positions.entries()]));
  } catch {
    // ignore quota errors
  }
}

function inferDirectionFromLatitude(lat: number): LiveMonitorDirection {
  if (lat > -1.2) return "coming";
  if (lat < -2.8) return "going";
  return lat > -2.0 ? "coming" : "going";
}

function inferDirectionFromLocationText(location: string): LiveMonitorDirection {
  const text = location.toLowerCase();
  if (/tororo|uganda|malaba|busia|athi river|mombasa cement athi|no go zone|red zone/i.test(text)) {
    return "coming";
  }
  if (/mikindani|vipingo|mcl parking|spedag|kaloleni|mariakani|mombasa,? kenya/i.test(text)) {
    return "going";
  }
  if (/nairobi|emali|voi|machakos|kibwezi|ndii|chonyi|mwambiti|mombasa road/i.test(text)) {
    return "coming";
  }
  return "going";
}

function directionFromMovement(
  row: Pick<LiveMonitorRow, "lat" | "lon" | "speedKmh">,
  previous: PreviousPosition,
): LiveMonitorDirection | null {
  if (row.lat == null || row.lon == null) return null;

  const deltaLat = row.lat - previous.lat;
  const threshold = row.speedKmh > 5 ? LAT_THRESHOLD : LAT_THRESHOLD * 0.6;

  if (deltaLat >= threshold) return "going";
  if (deltaLat <= -threshold) return "coming";

  return null;
}

export function computeDirection(
  row: Pick<LiveMonitorRow, "lat" | "lon" | "speedKmh" | "geofence" | "currentLocation">,
  previous: PreviousPosition | undefined,
): LiveMonitorDirection {
  const geofence =
    row.geofence ?? resolveGeofence(row.lat, row.lon, row.currentLocation) ?? findGeofenceFromText(row.currentLocation);
  if (geofence) return "inside";

  if (previous?.lat != null && previous.lon != null) {
    const fromMovement = directionFromMovement(row, previous);
    if (fromMovement) return fromMovement;
  }

  if (row.lat != null) {
    return inferDirectionFromLatitude(row.lat);
  }

  return inferDirectionFromLocationText(row.currentLocation);
}

export function directionLabel(direction: LiveMonitorDirection, geofence?: string | null): string {
  if (direction === "inside") return geofence ? `Inside · ${geofence}` : "Inside";
  if (direction === "going") return "Going";
  return "Coming";
}

export function resolveRowGeofence(
  row: Pick<LiveMonitorRow, "lat" | "lon" | "geofence" | "currentLocation">,
): string | null {
  return row.geofence ?? resolveGeofence(row.lat, row.lon, row.currentLocation);
}

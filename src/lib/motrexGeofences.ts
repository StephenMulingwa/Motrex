import geofenceData from "../../motrex_geofences_selected.json";

export interface MotrexGeofenceCoordinate {
  lat: number;
  lng: number;
  radius: number;
}

export interface MotrexGeofence {
  id: number;
  name: string;
  type: number;
  radius: number;
  coordinates: MotrexGeofenceCoordinate[];
}

export const MOTREX_GEOFENCES = geofenceData as MotrexGeofence[];

/** Geofence IDs configured in Wialon template 58 (Motrex Geofence Visits). */
export const TEMPLATE_58_GEOFENCE_IDS = new Set([1, 54, 5, 6, 59, 52, 47]);

export const YARDS_TEMPLATE_GEOFENCES = MOTREX_GEOFENCES.filter((g) => TEMPLATE_58_GEOFENCE_IDS.has(g.id));

export const YARDS_ZONE_COUNT = YARDS_TEMPLATE_GEOFENCES.length;

/** All Motrex selected geofences shown in Live Monitor / Yards discovery (includes Athi River). */
export const SELECTED_GEOFENCE_NAMES = MOTREX_GEOFENCES.map((g) => g.name);

/** Template-58 yard zone names only (visit-history enrichment). */
export const YARDS_TEMPLATE_GEOFENCE_NAMES = YARDS_TEMPLATE_GEOFENCES.map((g) => g.name);

function normalizeGeofenceName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const YARDS_GEOFENCE_LOOKUP = new Map(
  YARDS_TEMPLATE_GEOFENCES.map((g) => [normalizeGeofenceName(g.name), g.name]),
);

const MOTREX_GEOFENCE_LOOKUP = new Map(
  MOTREX_GEOFENCES.map((g) => [normalizeGeofenceName(g.name), g.name]),
);

const GEOFENCE_TEXT_ALIASES: { pattern: RegExp; name: string }[] = [
  { pattern: /mcl\s*parking\s*vipingo/i, name: "MCL PARKING VIPINGO" },
  { pattern: /vipingo\s*main\s*yard/i, name: "Vipingo Main yard" },
  { pattern: /vipingo[\s_]*loading/i, name: "Vipingo_Loading_Zone" },
  { pattern: /motrex\s*mikindani/i, name: "Motrex Mikindani Yard" },
  { pattern: /mikindani\s*yard/i, name: "Motrex Mikindani Yard" },
  { pattern: /no\s*go\s*zone|red\s*zone/i, name: "MOTREX NO GO ZONE_RED ZONE" },
  { pattern: /tororo\s*cement\s*\(\s*parking\s*\)/i, name: "Tororo Cement(Parking)" },
  { pattern: /tororo\s*cement\s*\(\s*uganda\s*\)/i, name: "Tororo Cement(Uganda)" },
  { pattern: /tororo\s*cement/i, name: "Tororo Cement(Uganda)" },
  { pattern: /mombasa\s*cement\s*athi|athi\s*river\s*cement/i, name: "Mombasa Cement Athi River" },
  ...MOTREX_GEOFENCES.map((g) => ({
    pattern: new RegExp(g.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    name: g.name,
  })),
];

function pointInPolygon(lat: number, lng: number, polygon: MotrexGeofenceCoordinate[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lng;
    const yj = polygon[j].lat;
    const xj = polygon[j].lng;

    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

/** Returns the first matching geofence name for a lat/lng point, or null. */
export function findGeofenceAt(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null;

  for (const geofence of MOTREX_GEOFENCES) {
    if (pointInPolygon(lat, lon, geofence.coordinates)) {
      return geofence.name;
    }
  }

  return null;
}

/** Match geofence name from Wialon location text when polygon lookup misses. */
export function findGeofenceFromText(location: string): string | null {
  const text = String(location ?? "").trim();
  if (!text || text === "—") return null;

  for (const { pattern, name } of GEOFENCE_TEXT_ALIASES) {
    if (pattern.test(text)) return name;
  }

  return null;
}

/** Map a Wialon geofence label to a template-58 yard zone name, or null. */
export function matchSelectedGeofence(wialonName: string): string | null {
  const text = String(wialonName ?? "").trim();
  if (!text || text === "—") return null;

  const exact = YARDS_GEOFENCE_LOOKUP.get(normalizeGeofenceName(text));
  if (exact) return exact;

  const fuzzy = findGeofenceFromText(text);
  if (!fuzzy) return null;
  return YARDS_GEOFENCE_LOOKUP.has(normalizeGeofenceName(fuzzy)) ? fuzzy : null;
}

/** Map a label to any Motrex selected geofence (Live Monitor / Yards discovery set). */
export function matchMotrexGeofence(wialonName: string): string | null {
  const text = String(wialonName ?? "").trim();
  if (!text || text === "—") return null;

  const exact = MOTREX_GEOFENCE_LOOKUP.get(normalizeGeofenceName(text));
  if (exact) return exact;

  const fuzzy = findGeofenceFromText(text);
  if (!fuzzy) return null;
  return MOTREX_GEOFENCE_LOOKUP.has(normalizeGeofenceName(fuzzy)) ? fuzzy : null;
}

export function resolveGeofence(
  lat: number | null,
  lon: number | null,
  location: string,
): string | null {
  return findGeofenceAt(lat, lon) ?? findGeofenceFromText(location);
}

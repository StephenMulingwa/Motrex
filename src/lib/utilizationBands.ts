export interface UtilizationBand {
  label: string;
  minInclusive: number;
  maxExclusive?: number;
  hex: string;
  rgb: [number, number, number];
  argb: string;
}

export const UTILIZATION_BANDS: UtilizationBand[] = [
  { label: "Less Than 0.1 Km", minInclusive: 0, maxExclusive: 0.1, hex: "#ff0000", rgb: [255, 0, 0], argb: "FFFF0000" },
  { label: "Less Than 10 km", minInclusive: 0.1, maxExclusive: 10, hex: "#ffc000", rgb: [255, 192, 0], argb: "FFFFC000" },
  { label: "Less Than 100 Km", minInclusive: 10, maxExclusive: 100, hex: "#ffff00", rgb: [255, 255, 0], argb: "FFFFFF00" },
  { label: "More Than 100 Km", minInclusive: 100, hex: "#92d050", rgb: [146, 208, 80], argb: "FF92D050" },
];

export function getUtilizationBand(distanceKm: number): UtilizationBand {
  if (!Number.isFinite(distanceKm) || distanceKm < 0.1) return UTILIZATION_BANDS[0];
  return UTILIZATION_BANDS.find((band) => distanceKm >= band.minInclusive && (band.maxExclusive == null || distanceKm < band.maxExclusive)) ?? UTILIZATION_BANDS[0];
}

"use client";

/** Split long violation / category names for multi-line X-axis labels in Recharts. */
export function splitCategoryLabel(value: string, maxLen: number): string[] {
  const v = String(value ?? "").trim();
  if (!v) return [""];
  if (v.length <= maxLen) return [v];
  const words = v.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxLen) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    if (w.length <= maxLen) {
      cur = w;
    } else {
      let rest = w;
      while (rest.length > maxLen) {
        lines.push(rest.slice(0, maxLen));
        rest = rest.slice(maxLen);
      }
      cur = rest;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [v];
}

type Payload = { value?: string };

/** Props Recharts passes to XAxis `tick` plus optional `maxChars`. */
export type CategoryAxisTickProps = {
  x?: number | string;
  y?: number | string;
  payload?: Payload;
  maxChars?: number;
  [key: string]: unknown;
};

function num(v: number | string | undefined, fallback: number) {
  if (v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Recharts XAxis tick: centered, multi-line category text. */
export function CategoryAxisTick({ x = 0, y = 0, payload, maxChars = 14 }: CategoryAxisTickProps) {
  const lines = splitCategoryLabel(String(payload?.value ?? ""), maxChars);
  const lineHeight = 11;
  const nx = num(x, 0);
  const ny = num(y, 0);
  return (
    <g transform={`translate(${nx},${ny})`}>
      <text textAnchor="middle" fill="#4d6488" fontSize={10} style={{ fontFamily: "var(--font-body), sans-serif" }}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 4 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type ChartBoxProps = {
  height: number;
  minHeight?: number;
  children: (size: { width: number; height: number }) => ReactNode;
};

/** Renders chart children only once the container has measurable size (avoids Recharts -1 warnings). */
export default function ChartBox({ height, minHeight = 200, children }: ChartBoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const width = el.clientWidth;
      const h = el.clientHeight;
      if (width > 0 && h > 0) {
        setSize({ width, height: h });
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        height,
        minHeight,
        minWidth: 0,
      }}
    >
      {size ? children(size) : null}
    </div>
  );
}

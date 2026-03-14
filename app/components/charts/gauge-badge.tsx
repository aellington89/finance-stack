"use client";

import { useEffect, useState } from "react";

/**
 * Semi-circular gauge with colored range segments and a triangle pointer.
 * Rendered client-side only to avoid SSR/client floating-point
 * hydration mismatches in SVG path coordinates.
 */

interface Segment {
  max: number;
  color: string;
}

export interface GaugeBadgeProps {
  title: string;
  label: string;
  value: number;
  min?: number;
  max: number;
  segments: Segment[];
}

// Gauge dimensions
const SIZE = 240;
const STROKE = 28;
const CX = SIZE / 2;
const CY = SIZE / 2 + 6;
const RADIUS = (SIZE - STROKE) / 2 - 4;
const SVG_W = SIZE;
const SVG_H = SIZE / 2 + 16;
const VB = `0 0 ${SVG_W} ${SVG_H}`;

function toXY(angle: number, r: number = RADIUS) {
  return {
    x: +(CX + r * Math.cos(angle)).toFixed(2),
    y: +(CY - r * Math.sin(angle)).toFixed(2),
  };
}

function arc(fromAngle: number, toAngle: number) {
  const s = toXY(fromAngle);
  const e = toXY(toAngle);
  const large = fromAngle - toAngle > Math.PI ? 1 : 0;
  return `M ${s.x} ${s.y} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${e.x} ${e.y}`;
}

export function GaugeBadge({
  title,
  label,
  value,
  min = 0,
  max,
  segments,
}: GaugeBadgeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Determine which segment color the value falls in
  let valueColor = segments[0]?.color ?? "#888";
  let segStart = min;
  for (const seg of segments) {
    if (value >= segStart && value <= seg.max) {
      valueColor = seg.color;
      break;
    }
    segStart = seg.max;
  }
  if (value > (segments.at(-1)?.max ?? max)) {
    valueColor = segments.at(-1)?.color ?? "#888";
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-base font-medium text-muted-foreground text-center leading-tight whitespace-nowrap">
        {title}
      </span>
      <div style={{ width: SVG_W, height: SVG_H }}>
        {mounted && (
          <GaugeSVG
            value={value}
            min={min}
            max={max}
            segments={segments}
            label={label}
            valueColor={valueColor}
          />
        )}
      </div>
    </div>
  );
}

function GaugeSVG({
  value,
  min,
  max,
  segments,
  label,
  valueColor,
}: {
  value: number;
  min: number;
  max: number;
  segments: Segment[];
  label: string;
  valueColor: string;
}) {
  function valToAngle(v: number) {
    const clamped = Math.max(min, Math.min(max, v));
    const ratio = (clamped - min) / (max - min);
    return Math.PI * (1 - ratio);
  }

  // Segment arcs
  const arcs: { d: string; color: string }[] = [];
  let prevMax = min;
  for (const seg of segments) {
    const a1 = valToAngle(prevMax);
    const a2 = valToAngle(seg.max);
    if (Math.abs(a1 - a2) > 0.001) {
      arcs.push({ d: arc(a1, a2), color: seg.color });
    }
    prevMax = seg.max;
  }

  // Triangle pointer — tip on outer edge, base on inner edge of the arc stroke
  const angle = valToAngle(value);
  const pointerSpread = 10;
  const tipR = RADIUS + STROKE / 2 + 1; // just barely past outer edge
  const baseR = RADIUS - STROKE / 2 - 1; // just inside inner edge
  const tip = toXY(angle, tipR);
  const baseL = toXY(angle + pointerSpread / baseR, baseR);
  const baseRt = toXY(angle - pointerSpread / baseR, baseR);
  const pointerPath = `M ${tip.x} ${tip.y} L ${baseL.x} ${baseL.y} L ${baseRt.x} ${baseRt.y} Z`;

  return (
    <svg width={SVG_W} height={SVG_H} viewBox={VB} className="overflow-visible">
      {/* Background track */}
      <path
        d={arc(Math.PI, 0)}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      {/* Colored segments */}
      {arcs.map((seg, i) => (
        <path
          key={i}
          d={seg.d}
          fill="none"
          stroke={seg.color}
          strokeWidth={STROKE}
          strokeLinecap="butt"
        />
      ))}
      {/* Triangle pointer with outline for visibility */}
      <path
        d={pointerPath}
        fill="hsl(var(--foreground))"
        stroke="hsl(var(--background))"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* Value label */}
      <text
        x={CX}
        y={CY - 4}
        textAnchor="middle"
        dominantBaseline="auto"
        fill={valueColor}
        style={{ fontSize: 34, fontWeight: 700 }}
      >
        {label}
      </text>
    </svg>
  );
}

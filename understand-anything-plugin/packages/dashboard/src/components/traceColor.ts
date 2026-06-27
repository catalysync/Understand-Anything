// Wave-5 feature 44 — "Color by:" dimension. Pure helpers (no React, no store)
// that map a hop node to a stable color under one of several dimensions, plus a
// legend builder. Kept separate from TraceView so the color logic can be reasoned
// about in isolation and reused by the per-hop rail/badge + the legend chip row.
import type { GraphNode } from "@understand-anything/core/types";
import { packageOf, packageLabel } from "./traceGraph";
import { heatValue, heatColor } from "./traceDebug";

/** The selectable color dimensions. "none" falls back to per-type node colors. */
export type ColorDimension = "none" | "package" | "layer" | "complexity" | "watched";

export const COLOR_DIMENSIONS: { id: ColorDimension; label: string }[] = [
  { id: "none", label: "None" },
  { id: "package", label: "Package" },
  { id: "layer", label: "Layer" },
  { id: "complexity", label: "Complexity" },
  { id: "watched", label: "Watched" },
];

/**
 * A fixed, readable palette for categorical dimensions (package / layer). Picked
 * to contrast on the dark surface and to be distinct from the accent/gold theme
 * tints used elsewhere. Cycled by a stable hash so the same key keeps its color.
 */
const CATEGORICAL_PALETTE = [
  "rgb(96, 165, 250)", // blue
  "rgb(52, 211, 153)", // emerald
  "rgb(251, 191, 36)", // amber
  "rgb(244, 114, 182)", // pink
  "rgb(167, 139, 250)", // violet
  "rgb(45, 212, 191)", // teal
  "rgb(248, 113, 113)", // red
  "rgb(163, 230, 53)", // lime
  "rgb(251, 146, 60)", // orange
  "rgb(129, 140, 248)", // indigo
];

/** Deterministic small hash → palette index (stable across renders). */
function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % CATEGORICAL_PALETTE.length;
  return CATEGORICAL_PALETTE[idx];
}

const COMPLEXITY_COLOR: Record<string, string> = {
  simple: "rgb(74, 222, 128)",
  moderate: "rgb(251, 191, 36)",
  complex: "rgb(248, 113, 113)",
};

const WATCHED_HIT = "rgb(56, 189, 248)"; // sky — touches a watched symbol
const NEUTRAL = "var(--color-text-muted)";

/** Context the color function reads (membership lookups + per-hop hit info). */
export interface ColorContext {
  /** node id → layer name (or id) for the "layer" dimension. */
  layerNameById: Map<string, string>;
  /** node ids whose source touches a watched symbol (for "watched"). */
  watchedHitIds: Set<string>;
}

/**
 * The color for one hop under a dimension. Returns null for "none" so the caller
 * can fall back to its existing per-type node color (keeps Wave 0-3 visuals).
 */
export function colorForNode(
  dim: ColorDimension,
  node: GraphNode,
  ctx: ColorContext,
): string | null {
  switch (dim) {
    case "none":
      return null;
    case "package":
      return hashColor(packageOf(node));
    case "layer": {
      const name = ctx.layerNameById.get(node.id);
      return name ? hashColor(name) : NEUTRAL;
    }
    case "complexity":
      return COMPLEXITY_COLOR[node.complexity] ?? NEUTRAL;
    case "watched":
      return ctx.watchedHitIds.has(node.id) ? WATCHED_HIT : NEUTRAL;
    default:
      return null;
  }
}

export interface LegendEntry {
  label: string;
  color: string;
}

/**
 * Build the legend for the current dimension over the visible hops. For
 * categorical dimensions the legend lists every distinct value present (capped);
 * for complexity it lists the three buckets; for watched the hit/no-hit split.
 */
export function buildLegend(
  dim: ColorDimension,
  hops: GraphNode[],
  ctx: ColorContext,
): LegendEntry[] {
  switch (dim) {
    case "none":
      return [];
    case "package": {
      const seen = new Map<string, string>();
      for (const n of hops) {
        const pkg = packageOf(n);
        if (!seen.has(pkg)) seen.set(pkg, hashColor(pkg));
      }
      return [...seen.entries()]
        .map(([pkg, color]) => ({ label: packageLabel(pkg), color }))
        .slice(0, 12);
    }
    case "layer": {
      const seen = new Map<string, string>();
      for (const n of hops) {
        const name = ctx.layerNameById.get(n.id) ?? "(no layer)";
        if (!seen.has(name)) seen.set(name, name === "(no layer)" ? NEUTRAL : hashColor(name));
      }
      return [...seen.entries()]
        .map(([label, color]) => ({ label, color }))
        .slice(0, 12);
    }
    case "complexity":
      return [
        { label: "simple", color: COMPLEXITY_COLOR.simple },
        { label: "moderate", color: COMPLEXITY_COLOR.moderate },
        { label: "complex", color: COMPLEXITY_COLOR.complex },
      ];
    case "watched":
      return [
        { label: "touches watch", color: WATCHED_HIT },
        { label: "no hit", color: NEUTRAL },
      ];
    default:
      return [];
  }
}

// Re-export the heat helpers some callers may want alongside color-by.
export { heatValue, heatColor };

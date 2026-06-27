// Layer color + rename overrides (200-79) — persisted to localStorage,
// keyed per project. Resolvers fall back to the index-based LAYER_PALETTE so
// existing call sites keep working when no override is set.
import { LAYER_PALETTE, getLayerColor } from "../components/LayerLegend";

export interface LayerOverride {
  /** Hex (or any CSS color) for the layer's accent; derives bg/border. */
  color?: string;
  /** Custom display name. */
  name?: string;
}

export type LayerOverrideMap = Record<string, LayerOverride>;

function key(projectKey: string): string {
  return `ua-layer-overrides-v1:${projectKey}`;
}

export function loadLayerOverrides(projectKey: string): LayerOverrideMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key(projectKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as LayerOverrideMap;
  } catch { /* ignore */ }
  return {};
}

export function saveLayerOverrides(projectKey: string, map: LayerOverrideMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(projectKey), JSON.stringify(map));
  } catch { /* ignore */ }
}

/** Resolve a layer color (override → palette by index). Returns {bg,border,label}. */
export function resolveLayerColor(
  overrides: LayerOverrideMap | undefined,
  layerId: string,
  index: number,
): { bg: string; border: string; label: string } {
  const ov = overrides?.[layerId]?.color;
  if (ov) {
    return { bg: withAlpha(ov, 0.12), border: withAlpha(ov, 0.4), label: ov };
  }
  return getLayerColor(index);
}

/** Resolve a layer name (override → fallback). */
export function resolveLayerName(
  overrides: LayerOverrideMap | undefined,
  layerId: string,
  fallback: string,
): string {
  return overrides?.[layerId]?.name?.trim() || fallback;
}

/** Suggested swatches for the picker (palette accents + a few extras). */
export const COLOR_SWATCHES: string[] = [
  ...LAYER_PALETTE.map((p) => p.label),
  "#d35d6e", "#e0894a", "#c9a06c", "#7da7d4", "#9b8cc4", "#6fae8b",
];

/** Convert hex/rgb to an rgba with the given alpha (best-effort). */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.startsWith("#") ? hex.slice(1) : hex);
  if (m) {
    const int = parseInt(m[1], 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // already rgb()/hsl() — wrap as-is at full alpha for border, else leave.
  return color;
}

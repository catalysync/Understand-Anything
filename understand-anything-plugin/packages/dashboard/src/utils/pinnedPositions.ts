// ── Pinned / frozen node positions (200-series item 50) ─────────────────────
//
// A node can be "pinned" so a re-layout (filter change, declutter, layout
// switch) keeps it at a fixed coordinate instead of letting ELK/force move it.
// Pins are persisted to localStorage (NOT workspace.json — server whitelist
// drops unknown keys), namespaced per project. The map is nodeId → {x,y} in
// ELK/layout coordinates (the same space stage-1 children are positioned in).

const PINNED_KEY_PREFIX = "ua-pinned-positions-v1:";

export interface PinnedPos {
  x: number;
  y: number;
}

export type PinnedPositions = Record<string, PinnedPos>;

function pinnedKey(p: string): string {
  return `${PINNED_KEY_PREFIX}${p || "default"}`;
}

export function loadPinnedPositions(projectKey: string): PinnedPositions {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(pinnedKey(projectKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const out: PinnedPositions = {};
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (typeof o.x === "number" && typeof o.y === "number") {
            out[id] = { x: o.x, y: o.y };
          }
        }
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function savePinnedPositions(projectKey: string, pins: PinnedPositions): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pinnedKey(projectKey), JSON.stringify(pins));
  } catch {
    /* ignore */
  }
}

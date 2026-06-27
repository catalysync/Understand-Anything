// ── Filter presets (200-series item 74) ─────────────────────────────────────
//
// One-click named presets that compute a node-id allow-set over the WHOLE
// graph (so they compose with the existing layer/visibility machinery). Each
// preset returns the ids to KEEP; an empty result means "no preset constraint"
// is surfaced by the caller as an empty-state rather than a blank graph.

import type { KnowledgeGraph } from "@understand-anything/core/types";
import { gitMetaFor } from "./gitMeta";
import { COMPLEXITY_RANK } from "../store";
import type { Complexity } from "../store";
import { recentlyChangedIds } from "./gitMeta";

export type FilterPresetId =
  | "hubs"
  | "untestedComplex"
  | "publicApi"
  | "entrypoints"
  | "recentlyChanged";

export interface FilterPresetDef {
  id: FilterPresetId;
  label: string;
  /** Short tooltip describing the preset. */
  hint: string;
}

export const FILTER_PRESETS: FilterPresetDef[] = [
  { id: "hubs", label: "Hubs only", hint: "High-degree connector nodes" },
  { id: "untestedComplex", label: "Untested complex", hint: "Complex code with no tested_by/covers edge" },
  { id: "publicApi", label: "Public API", hint: "Endpoints, routes & handlers" },
  { id: "entrypoints", label: "Entrypoints", hint: "Routes, commands, events, schedules, APIs" },
  { id: "recentlyChanged", label: "Recently changed", hint: "Touched within ~30 days (git)" },
];

const ENTRYPOINT_TYPES = new Set([
  "route",
  "command",
  "event",
  "schedule",
  "api",
  "endpoint",
]);
const API_SURFACE_TYPES = new Set(["endpoint", "route", "api"]);
const COVER_EDGE_TYPES = new Set(["tested_by", "covers", "asserts_on"]);

/**
 * Compute the keep-set for a preset. Returns null when the preset isn't
 * applicable (graph missing) — caller treats null as "no constraint".
 */
export function presetNodeIds(
  preset: FilterPresetId,
  graph: KnowledgeGraph | null,
): Set<string> | null {
  if (!graph) return null;

  switch (preset) {
    case "hubs": {
      const degree = new Map<string, number>();
      for (const e of graph.edges) {
        if (e.source === e.target) continue;
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      }
      // Hub threshold: top-quartile degree, floored at 4.
      const degs = [...degree.values()].sort((a, b) => b - a);
      if (degs.length === 0) return new Set();
      const q = degs[Math.floor(degs.length * 0.1)] ?? degs[0];
      const threshold = Math.max(4, q);
      const keep = new Set<string>();
      for (const [id, d] of degree) if (d >= threshold) keep.add(id);
      return keep;
    }

    case "untestedComplex": {
      // Code nodes whose complexity is "complex" AND that have no incoming
      // cover edge (covers/tested_by/asserts_on) pointing at them.
      const tested = new Set<string>();
      for (const e of graph.edges) {
        if (!COVER_EDGE_TYPES.has(e.type)) continue;
        // covers: test→code (target tested); tested_by: code→test (source tested)
        if (e.type === "tested_by") tested.add(e.source);
        else tested.add(e.target);
      }
      const keep = new Set<string>();
      for (const n of graph.nodes) {
        const rank = COMPLEXITY_RANK[n.complexity as Complexity];
        if (rank !== 2) continue;
        if (tested.has(n.id)) continue;
        keep.add(n.id);
      }
      return keep;
    }

    case "publicApi": {
      const keep = new Set<string>();
      for (const n of graph.nodes) {
        if (API_SURFACE_TYPES.has(n.type)) keep.add(n.id);
        else if (n.type === "function" && /handler|handle|controller/i.test(n.name)) {
          keep.add(n.id);
        }
      }
      return keep;
    }

    case "entrypoints": {
      const keep = new Set<string>();
      for (const n of graph.nodes) if (ENTRYPOINT_TYPES.has(n.type)) keep.add(n.id);
      return keep;
    }

    case "recentlyChanged":
      return recentlyChangedIds(graph);

    default:
      return null;
  }
}

/** True if a preset can produce a non-empty result for this graph. */
export function presetAvailable(
  preset: FilterPresetId,
  graph: KnowledgeGraph | null,
): boolean {
  const ids = presetNodeIds(preset, graph);
  return ids !== null && ids.size > 0;
}

// Item 196: one shared diff-overlay selector used by structural / domain / trace.
//
// The diff-overlay.json (changedNodeIds / affectedNodeIds) is loaded once in
// App.tsx into the store. Structural already colors from it; this hook projects
// the SAME sets onto any view's node ids so domain steps + trace hops light up
// consistently. Domain steps are matched by their filePath → structural node id
// (filePathToNodeId), so a changed file lights up its domain step too.
//
// No-ops gracefully when diff mode is off or no overlay was loaded.

import { useMemo } from "react";
import { useDashboardStore } from "../store";

export type DiffStatus = "changed" | "affected" | null;

/**
 * Resolve the diff status of a node id for the current view. `filePath` is an
 * optional fallback used for domain steps (whose ids differ from structural
 * nodes but share a file) — when given and the id itself isn't in the overlay,
 * the matching structural node id (by file) is consulted.
 */
export function useDiffOverlay(
  nodeId: string | null | undefined,
  filePath?: string | null,
): DiffStatus {
  const diffMode = useDashboardStore((s) => s.diffMode);
  const changed = useDashboardStore((s) => s.changedNodeIds);
  const affected = useDashboardStore((s) => s.affectedNodeIds);
  const filePathToNodeId = useDashboardStore((s) => s.filePathToNodeId);

  return useMemo(() => {
    if (!diffMode || !nodeId) return null;
    if (changed.has(nodeId)) return "changed";
    if (affected.has(nodeId)) return "affected";
    if (filePath) {
      const structuralId = filePathToNodeId.get(filePath);
      if (structuralId) {
        if (changed.has(structuralId)) return "changed";
        if (affected.has(structuralId)) return "affected";
      }
    }
    return null;
  }, [diffMode, nodeId, filePath, changed, affected, filePathToNodeId]);
}

/** Non-hook variant for imperative call sites (loops over many nodes). */
export function diffStatusFor(
  nodeId: string,
  filePath: string | null | undefined,
  changed: Set<string>,
  affected: Set<string>,
  filePathToNodeId: Map<string, string>,
): DiffStatus {
  if (changed.has(nodeId)) return "changed";
  if (affected.has(nodeId)) return "affected";
  if (filePath) {
    const structuralId = filePathToNodeId.get(filePath);
    if (structuralId) {
      if (changed.has(structuralId)) return "changed";
      if (affected.has(structuralId)) return "affected";
    }
  }
  return null;
}

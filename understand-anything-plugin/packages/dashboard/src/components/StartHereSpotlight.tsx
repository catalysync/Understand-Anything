import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 133: "Start here" entry-point spotlight.
 *
 * On first load (per project, persisted via the same localStorage learning
 * slice) we surface the detected entry point — tour step 1's first node, else
 * the highest fan-in node — as a pulsing "Start here →" pill. Clicking it
 * focuses that node in the structural graph so a newcomer has an obvious first
 * move. Auto-hides once dismissed, once the tour starts, or once a node is
 * selected.
 */

const SEEN_KEY = "ua-starthere-seen-v1";

function seenKey(project: string): string {
  return `${SEEN_KEY}:${project || "default"}`;
}

export default function StartHereSpotlight() {
  const graph = useDashboardStore((s) => s.graph);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const [dismissed, setDismissed] = useState(false);

  const projectName = graph?.project.name ?? "default";

  // Resolve the entry node + its display name.
  const entry = useMemo(() => {
    if (!graph) return null;
    const sortedTour = [...(graph.tour ?? [])].sort((a, b) => a.order - b.order);
    const fromTour = sortedTour[0]?.nodeIds?.[0];
    let entryId = fromTour && graph.nodes.some((n) => n.id === fromTour) ? fromTour : null;
    if (!entryId) {
      // Highest fan-in (incoming edges) node.
      const fanIn = new Map<string, number>();
      for (const e of graph.edges) {
        fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestN = -1;
      for (const [id, n] of fanIn) {
        if (n > bestN) {
          bestN = n;
          best = id;
        }
      }
      entryId = best;
    }
    if (!entryId) return null;
    const node = graph.nodes.find((n) => n.id === entryId);
    return node ? { id: node.id, name: node.name } : null;
  }, [graph]);

  // First-load gate (persisted per project).
  useEffect(() => {
    if (typeof window === "undefined" || !graph) return;
    if (window.localStorage.getItem(seenKey(projectName)) === "1") {
      setDismissed(true);
    }
  }, [graph, projectName]);

  const markSeen = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(seenKey(projectName), "1");
    }
    setDismissed(true);
  };

  const visible =
    !!entry &&
    !dismissed &&
    !tourActive &&
    !selectedNodeId &&
    viewMode === "structural";

  if (!visible || !entry) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
      <style>{KEYFRAMES}</style>
      <div
        className="flex items-center gap-2 rounded-full border border-accent/50 bg-surface/95 shadow-lg pl-3 pr-1.5 py-1.5"
        style={{ animation: "ua-starthere-pulse 2.2s ease-in-out infinite" }}
      >
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          New here?
        </span>
        <button
          type="button"
          onClick={() => {
            focusEntity(entry.id, { view: "structural" });
            markSeen();
          }}
          className="flex items-center gap-1.5 rounded-full bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold px-3 py-1 transition-colors"
          title={`Jump to the entry point: ${entry.name}`}
        >
          <span aria-hidden>◎</span>
          Start here: {entry.name} →
        </button>
        <button
          type="button"
          onClick={markSeen}
          className="w-6 h-6 rounded-full text-text-muted hover:text-text-primary hover:bg-elevated transition-colors text-sm"
          title="Dismiss"
          aria-label="Dismiss start-here hint"
        >
          ×
        </button>
      </div>
    </div>
  );
}

const KEYFRAMES = `
@keyframes ua-starthere-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--color-accent-overlay-bg); transform: translateY(0); }
  50% { box-shadow: 0 0 0 8px transparent; transform: translateY(-2px); }
}`;

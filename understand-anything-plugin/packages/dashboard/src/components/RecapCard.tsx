import { useMemo } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 172: "What changed since I was last here?" recap.
 *
 * On load the store diffs the current graph's node-ids (+ attrs.lastCommitAt)
 * against a persisted last-visit snapshot (localStorage). When something
 * changed and the user hasn't already dismissed *this* recap, a small card
 * appears under the header: "3 files changed in the auth layer since your last
 * visit — tour them?". "Tour them" focuses the first touched node.
 */
export default function RecapCard() {
  const recap = useDashboardStore((s) => s.visitRecap);
  const dismissedFor = useDashboardStore(
    (s) => s.learning.recapDismissedFor,
  );
  const dismissRecap = useDashboardStore((s) => s.dismissRecap);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const markVisited = useDashboardStore((s) => s.markVisited);

  const headline = useMemo(() => {
    if (!recap) return null;
    const total =
      recap.addedNodeIds.length + recap.changedNodeIds.length;
    if (total === 0 && recap.removedNodeIds.length === 0) return null;
    const top = recap.layerCounts[0];
    const where = top
      ? `in the ${top.layerName} layer`
      : "across the graph";
    const parts: string[] = [];
    if (recap.addedNodeIds.length)
      parts.push(`${recap.addedNodeIds.length} added`);
    if (recap.changedNodeIds.length)
      parts.push(`${recap.changedNodeIds.length} changed`);
    if (recap.removedNodeIds.length)
      parts.push(`${recap.removedNodeIds.length} removed`);
    return `${parts.join(" · ")} ${where} since your last visit`;
  }, [recap]);

  // Suppress on first-ever visit, when nothing changed, or already dismissed.
  if (
    !recap ||
    recap.firstVisit ||
    !headline ||
    dismissedFor === recap.signature
  ) {
    return null;
  }

  const lastVisit = recap.lastVisitAt
    ? new Date(recap.lastVisitAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  const tourThem = () => {
    const first = recap.changedNodeIds[0] ?? recap.addedNodeIds[0];
    if (first) {
      markVisited(first);
      focusEntity(first, { view: "structural" });
    }
    dismissRecap();
  };

  return (
    <div className="px-5 py-2.5 bg-accent/8 border-b border-accent/20 flex items-center gap-3">
      <span aria-hidden className="text-base shrink-0">
        🕘
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary">
          {headline}
          {lastVisit && (
            <span className="text-text-muted"> (last seen {lastVisit})</span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={tourThem}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors shrink-0"
      >
        Tour them
      </button>
      <button
        type="button"
        onClick={dismissRecap}
        className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none shrink-0"
        aria-label="Dismiss recap"
      >
        ×
      </button>
    </div>
  );
}

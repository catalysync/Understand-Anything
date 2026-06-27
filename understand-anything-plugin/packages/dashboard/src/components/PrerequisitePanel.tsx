import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { buildPrerequisiteOrder, type PrereqNode } from "../utils/curriculum";
import TrackSelector from "./TrackSelector";

/**
 * Item 155: Prerequisite graph for concepts.
 *
 * A "learn in this order" list: nodes ranked by inbound-dependency depth
 * (topological over imports/calls), so foundational nodes (depth 0, high
 * fan-in) come first and a "start here" marker sits on the first item. Rendered
 * as an ordered mini-DAG list; clicking focuses the node. The active role track
 * (item 157) scopes the set.
 */
export default function PrerequisitePanel() {
  const graph = useDashboardStore((s) => s.graph);
  const track = useDashboardStore((s) => s.learning.curriculumTrack);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const markVisited = useDashboardStore((s) => s.markVisited);

  const order = useMemo<PrereqNode[]>(
    () => (graph ? buildPrerequisiteOrder(graph, { track }) : []),
    [graph, track],
  );

  const maxDepth = useMemo(
    () => order.reduce((m, n) => Math.max(m, n.depth), 0),
    [order],
  );

  const open = (id: string) => {
    markVisited(id);
    focusEntity(id, { view: "structural" });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <TrackSelector />
        <p className="text-[11px] text-text-muted mt-2">
          Ranked by how foundational each piece is — depth 0 depends on nothing,
          so grok it first.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
        {order.length === 0 ? (
          <p className="text-center text-text-muted text-sm py-10">
            No dependency edges to order for this track.
          </p>
        ) : (
          <ol className="relative">
            {/* vertical spine */}
            <span
              aria-hidden
              className="absolute left-[7px] top-2 bottom-2 w-px bg-border-subtle"
            />
            {order.map((n, i) => (
              <li key={n.id} className="relative pl-6 pb-2">
                <span
                  aria-hidden
                  className={`absolute left-0 top-2 w-[15px] h-[15px] rounded-full border-2 ${
                    i === 0
                      ? "bg-accent border-accent"
                      : "bg-surface border-border-medium"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => open(n.id)}
                  className="w-full text-left rounded-lg border border-border-subtle bg-elevated hover:border-accent/40 px-3 py-2 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">
                        start here
                      </span>
                    )}
                    <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors truncate">
                      {n.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted font-mono">
                    <span className="px-1 py-0.5 rounded bg-surface">
                      {n.type}
                    </span>
                    <span title="dependency depth">
                      depth {n.depth}
                      {maxDepth ? `/${maxDepth}` : ""}
                    </span>
                    {n.fanIn > 0 && (
                      <span title="dependents (fan-in)">
                        {n.fanIn} dependents
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

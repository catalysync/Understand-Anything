import { useMemo } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 158: "You've explored X%" coverage meter.
 *
 * Tracks visited nodes (selected / explained / traced — recorded in the
 * localStorage learning slice) as a fraction of the graph's nodes and renders
 * an SVG ring. Shown on the ProjectOverview.
 */
export default function CoverageRing() {
  const graph = useDashboardStore((s) => s.graph);
  const visited = useDashboardStore((s) => s.learning.visitedNodeIds);

  const { pct, visitedCount, total } = useMemo(() => {
    const total = graph?.nodes.length ?? 0;
    // Only count visited ids that still resolve to a node in this graph.
    const ids = new Set(graph?.nodes.map((n) => n.id));
    const visitedCount = visited.filter((id) => ids.has(id)).length;
    const pct = total > 0 ? Math.min(100, (visitedCount / total) * 100) : 0;
    return { pct, visitedCount, total };
  }, [graph, visited]);

  if (total === 0) return null;

  const size = 72;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="mb-5 bg-elevated rounded-lg p-3 border border-border-subtle flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.22,1,0.36,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-mono font-medium text-accent">
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-text-primary mb-0.5">
          You've explored {pct.toFixed(0)}%
        </div>
        <div className="text-[11px] text-text-muted leading-relaxed">
          {visitedCount.toLocaleString()} of {total.toLocaleString()} nodes
          visited. Select, trace, or explain nodes to grow this.
        </div>
      </div>
    </div>
  );
}

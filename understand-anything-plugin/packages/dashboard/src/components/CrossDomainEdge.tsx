import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { weightToStrokeWidth, weightToOpacity } from "../utils/domainHelpers";

/**
 * Features 100 + 101: the domain-overview `cross_domain` edge.
 *  - stroke width/opacity scaled by the schema `weight` (0–1) so the
 *    longest/strongest spine reads as the spine (101),
 *  - an on-hover card showing the `description`, weight and direction (100).
 */
export interface CrossDomainEdgeData extends Record<string, unknown> {
  description?: string;
  weight: number;
  direction: "forward" | "backward" | "bidirectional";
  label?: string;
  /** Storyline / spine emphasis. */
  emphasized?: boolean;
  /** Dimmed when a flow / chain elsewhere is focused. */
  dimmed?: boolean;
}

export type CrossDomainFlowEdge = Edge<CrossDomainEdgeData, "cross-domain">;

const directionArrow: Record<string, string> = {
  forward: "→",
  backward: "←",
  bidirectional: "↔",
};

function CrossDomainEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  markerStart,
  data,
}: EdgeProps<CrossDomainFlowEdge>) {
  const [hover, setHover] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const weight = data?.weight ?? 0.5;
  const description = data?.description;
  const label = data?.label;
  const direction = data?.direction ?? "forward";
  const emphasized = data?.emphasized;
  const dimmed = data?.dimmed;

  const style: React.CSSProperties = {
    stroke: "var(--color-accent)",
    strokeWidth: weightToStrokeWidth(weight) + (emphasized ? 1.5 : 0),
    strokeDasharray: emphasized ? undefined : "6 3",
    opacity: dimmed ? 0.12 : weightToOpacity(weight),
  };

  return (
    <>
      {/* Fat invisible hit-area so hover works on thin edges. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ cursor: "help" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={style}
      />
      {(hover || label) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
              zIndex: hover ? 60 : 1,
            }}
            className={
              hover
                ? "max-w-[260px] rounded-md border border-accent/40 bg-surface px-3 py-2 shadow-2xl"
                : "rounded bg-surface/90 px-1.5 py-0.5 text-[10px] text-text-muted border border-border-subtle"
            }
          >
            {hover ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-accent">
                    Cross-domain
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {directionArrow[direction] ?? "→"} {direction}
                  </span>
                </div>
                {description && (
                  <div className="text-[11px] leading-snug text-text-primary">
                    {description}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted">
                    weight
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden min-w-[80px]">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.round(weight * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-accent">
                    {weight.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const CrossDomainEdge = memo(CrossDomainEdgeComponent);
export default CrossDomainEdge;

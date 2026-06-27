import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";

/**
 * Items 61 + 62: a structural edge that renders
 *  - directional arrow heads driven by the schema `direction`
 *    ("forward" → end arrow, "backward" → start arrow, "bidirectional"
 *    → both) via marker refs wired up in GraphView,
 *  - stroke width scaled by the schema `weight` (0–1),
 *  - an on-hover tooltip showing the edge `description`.
 *
 * The arrow markers themselves are static <marker> defs declared once in
 * GraphView; this component only references them by id through
 * `markerStart` / `markerEnd` set on the edge object, so it can stay a
 * lightweight wrapper around <BaseEdge>.
 */
export interface DirectionalEdgeData extends Record<string, unknown> {
  description?: string;
  edgeLabel?: string;
}

export type DirectionalFlowEdge = Edge<DirectionalEdgeData, "directional">;

function DirectionalEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  markerStart,
  style,
  data,
}: EdgeProps<DirectionalFlowEdge>) {
  const [hover, setHover] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const description = data?.description;
  const edgeLabel = data?.edgeLabel;

  return (
    <>
      {/* Invisible fat hit-area so hover works on thin edges. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: description ? "help" : "default" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} markerStart={markerStart} style={style} />
      {(hover || edgeLabel) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
              zIndex: hover ? 50 : 1,
            }}
            className={
              hover && description
                ? "max-w-[240px] rounded-md border border-border-medium bg-surface px-2.5 py-1.5 text-[11px] leading-snug text-text-primary shadow-xl"
                : "rounded bg-elevated/90 px-1.5 py-0.5 text-[10px] text-text-muted"
            }
          >
            {hover && description ? description : edgeLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const DirectionalEdge = memo(DirectionalEdgeComponent);
export default DirectionalEdge;

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  summary: string;
  entryPoint?: string;
  entryType?: string;
  stepCount: number;
  flowId: string;
  /** Feature 93: dimmed when another flow is focused. */
  dimmed?: boolean;
  /** Feature 93: this is the focused flow. */
  focused?: boolean;
}

export type FlowFlowNode = Node<FlowNodeData, "flow-node">;

function FlowNode({ data }: NodeProps<FlowFlowNode>) {
  const selectNode = useDashboardStore((s) => s.selectNode);
  const openContextMenu = useDashboardStore((s) => s.openContextMenu);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const focusedFlowId = useDashboardStore((s) => s.focusedFlowId);
  const setFocusedFlow = useDashboardStore((s) => s.setFocusedFlow);
  const isSelected = selectedNodeId === data.flowId;

  return (
    <div
      className={`rounded-lg border px-4 py-3 min-w-[240px] max-w-[320px] cursor-pointer transition-all ${
        data.focused
          ? "border-accent ring-2 ring-accent/40 bg-accent/10"
          : isSelected
            ? "border-accent bg-accent/10"
            : "border-border-medium bg-surface hover:border-accent/50"
      } ${data.dimmed ? "opacity-25" : ""}`}
      onClick={() => selectNode(data.flowId)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        // Feature 93: toggle focus-a-flow mode.
        setFocusedFlow(focusedFlowId === data.flowId ? null : data.flowId);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu(data.flowId, e.clientX, e.clientY);
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      {data.entryPoint && (
        <div className="text-[9px] font-mono text-accent/70 mb-1 truncate">
          {data.entryPoint}
        </div>
      )}
      <div className="flex items-center gap-1.5 mb-1">
        <div className="text-xs font-semibold text-text-primary truncate">
          {data.label}
        </div>
        {data.focused && (
          <span className="text-[8px] uppercase tracking-wider text-accent shrink-0">
            focused
          </span>
        )}
      </div>
      <div className="text-[10px] text-text-secondary line-clamp-2">
        {data.summary}
      </div>
      <div className="text-[9px] text-text-muted mt-1">
        {data.stepCount} step{data.stepCount !== 1 ? "s" : ""}
        <span className="ml-1 text-text-muted/60">· dbl-click to focus</span>
      </div>
    </div>
  );
}

export default memo(FlowNode);

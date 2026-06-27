import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";
import { useDiffOverlay } from "../hooks/useDiffOverlay";

export interface StepNodeData extends Record<string, unknown> {
  label: string;
  summary: string;
  filePath?: string;
  stepId: string;
  order: number;
  /** Feature 93: dimmed when another flow is focused. */
  dimmed?: boolean;
  /** Item 114: dimmed because it doesn't touch the active entity filter. */
  entityDimmed?: boolean;
}

export type StepFlowNode = Node<StepNodeData, "step-node">;

function StepNode({ data }: NodeProps<StepFlowNode>) {
  const selectNode = useDashboardStore((s) => s.selectNode);
  const openContextMenu = useDashboardStore((s) => s.openContextMenu);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const filePathToNodeId = useDashboardStore((s) => s.filePathToNodeId);
  const openStepFile = useDashboardStore((s) => s.openStepFile);
  const traceStepCode = useDashboardStore((s) => s.traceStepCode);
  const isSelected = selectedNodeId === data.stepId;
  // Item 196: project the shared PR diff-overlay onto this domain step (by id
  // or its file). Lights up steps whose code changed, same as structural/trace.
  const diffStatus = useDiffOverlay(data.stepId, data.filePath);

  // Feature 110/105: is the step's file present in the structural graph?
  const fileResolved = !!(data.filePath && filePathToNodeId.has(data.filePath));
  const fileMissing = !!data.filePath && !fileResolved;

  const diffBorder =
    diffStatus === "changed"
      ? "!border-[var(--color-diff-changed)]"
      : diffStatus === "affected"
        ? "!border-[var(--color-diff-affected)]"
        : "";

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 min-w-[180px] max-w-[240px] cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-border-subtle bg-elevated hover:border-accent/40"
      } ${diffBorder} ${data.dimmed || data.entityDimmed ? "opacity-25" : ""}`}
      onClick={() => selectNode(data.stepId)}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu(data.stepId, e.clientX, e.clientY);
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-text-muted/40 !w-1.5 !h-1.5" />
      <Handle type="source" position={Position.Right} className="!bg-text-muted/40 !w-1.5 !h-1.5" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-mono text-accent/60 shrink-0">
          {data.order}
        </span>
        <span className="text-[11px] font-medium text-text-primary truncate">
          {data.label}
        </span>
        {diffStatus && (
          <span
            className="ml-auto shrink-0 text-[8px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded"
            style={{
              color:
                diffStatus === "changed"
                  ? "var(--color-diff-changed)"
                  : "var(--color-diff-affected)",
              backgroundColor:
                diffStatus === "changed"
                  ? "var(--color-diff-changed-dim)"
                  : "color-mix(in srgb, var(--color-diff-affected) 12%, transparent)",
            }}
            title={`This file is ${diffStatus} in the diff`}
          >
            Δ
          </span>
        )}
      </div>
      <div className="text-[10px] text-text-secondary line-clamp-2">
        {data.summary}
      </div>
      {data.filePath && (
        <div className="flex items-center gap-1 mt-1.5">
          {fileResolved ? (
            <button
              type="button"
              title="Open source file"
              onClick={(e) => {
                e.stopPropagation();
                openStepFile(data.stepId);
              }}
              className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-text-muted hover:text-accent hover:border-accent/50 transition-colors max-w-[140px]"
            >
              <span className="shrink-0">{"{}"}</span>
              <span className="truncate">{data.filePath}</span>
            </button>
          ) : (
            <span
              title="File not found in structural graph"
              className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#c97070]/10 border border-[#c97070]/30 text-[#c97070] max-w-[150px]"
            >
              <span className="shrink-0">⚠</span>
              <span className="truncate">{data.filePath}</span>
            </span>
          )}
          {fileResolved && (
            <button
              type="button"
              title="Trace this code"
              onClick={(e) => {
                e.stopPropagation();
                traceStepCode(data.stepId);
              }}
              className="text-[9px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-text-muted hover:text-accent hover:border-accent/50 transition-colors shrink-0"
            >
              ▶ trace
            </button>
          )}
          {fileMissing && (
            <span className="text-[8px] uppercase tracking-wider text-[#c97070]/70">
              missing
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(StepNode);

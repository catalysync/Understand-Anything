// Wave-2 feature 15: hover popover card for a resolvable symbol / hop node.
// Shows name, one-line signature, summary, incoming-call ref-count, and quick
// actions (↦ trace from here · ✦ explain). Positioned at the anchor; dismissed
// by the parent on mouse-out (debounced there).
import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { callCountOf, packageLabel, packageOf, signatureFromSource } from "./traceGraph";
import type { GraphNode } from "@understand-anything/core/types";

export interface HoverTarget {
  node: GraphNode;
  /** Pixel anchor (viewport coords) for the card. */
  x: number;
  y: number;
  /** Full file source for the node's file, if already loaded (for signature). */
  source?: string | null;
}

export default function HoverPopover({
  target,
  onClose,
  onExplain,
}: {
  target: HoverTarget;
  onClose: () => void;
  onExplain?: (node: GraphNode) => void;
}) {
  const graph = useDashboardStore((s) => s.graph);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);

  const node = target.node;
  const refCount = useMemo(() => (graph ? callCountOf(graph, node.id) : 0), [graph, node.id]);
  const signature = useMemo(
    () => signatureFromSource(target.source ?? undefined, node),
    [target.source, node],
  );

  // Clamp horizontally so the card stays on screen.
  const left = Math.min(target.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 360);
  const top = target.y + 14;

  return (
    <div
      data-testid="hover-popover"
      className="fixed z-[55] w-80 rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden text-left"
      style={{ left: Math.max(8, left), top }}
      onMouseLeave={onClose}
    >
      <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-2">
        <span
          className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={{ color: "var(--color-accent)", backgroundColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
        >
          {node.type}
        </span>
        <span className="text-[13px] font-mono text-text-primary truncate">{node.name}</span>
        <span className="text-[10px] text-text-muted ml-auto shrink-0" title="Incoming calls">
          {refCount} ref{refCount === 1 ? "" : "s"}
        </span>
      </div>
      {signature && (
        <div className="px-3 py-1.5 border-b border-border-subtle/60 bg-root/40">
          <code className="text-[11px] text-node-function font-mono break-words whitespace-pre-wrap">
            {signature}
          </code>
        </div>
      )}
      <div className="px-3 py-2">
        <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-4">
          {node.summary?.trim() ? node.summary : "No summary available."}
        </p>
        <div className="text-[10px] font-mono text-text-muted mt-1.5 truncate">
          {packageLabel(packageOf(node))}
          {node.lineRange ? ` · ${node.filePath}:${node.lineRange[0]}` : ""}
        </div>
      </div>
      <div className="px-3 py-2 border-t border-border-subtle flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            startTraceAt(node.id);
            onClose();
          }}
          className="text-[10px] font-semibold px-2 py-1 rounded border border-accent/40 text-accent hover:text-accent-bright hover:border-accent/70 transition-colors"
          title="Trace from here"
        >
          ↦ trace from here
        </button>
        {onExplain && (
          <button
            type="button"
            onClick={() => {
              onExplain(node);
              onClose();
            }}
            className="text-[10px] font-semibold px-2 py-1 rounded border border-border-subtle text-text-muted hover:text-text-primary transition-colors"
            title="Explain this symbol"
          >
            ✦ explain
          </button>
        )}
      </div>
    </div>
  );
}

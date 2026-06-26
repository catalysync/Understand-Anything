// Wave-2 feature 13: find references / callers panel.
// Lists every caller/reference of a node, grouped by file. Each row is
// clickable to jump (re-root the trace at that reference). Driven by
// referencesOf() — incoming `calls` plus `imports` of the defining file.
import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { groupReferencesByFile, referencesOf } from "./traceGraph";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

export default function ReferencesPanel({
  node,
  graph,
  onClose,
  onJump,
}: {
  node: GraphNode;
  graph: KnowledgeGraph;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const setTraceRoot = useDashboardStore((s) => s.setTraceRoot);
  const grouped = useMemo(() => groupReferencesByFile(referencesOf(graph, node.id)), [graph, node.id]);
  const total = grouped.reduce((acc, g) => acc + g.refs.length, 0);

  const jump = (id: string) => {
    if (onJump) onJump(id);
    else setTraceRoot(id);
  };

  return (
    <div
      data-testid="references-panel"
      className="px-3 pb-2.5 -mt-1 border-t border-border-subtle pt-2"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          {total} reference{total === 1 ? "" : "s"} · {grouped.length} file{grouped.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-text-muted hover:text-text-primary"
          title="Close references"
        >
          ✕
        </button>
      </div>
      {total === 0 ? (
        <div className="text-[11px] text-text-muted">No references found (no incoming calls/imports).</div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-auto">
          {grouped.map((g) => (
            <div key={g.file}>
              <div className="text-[10px] font-mono text-text-secondary truncate mb-1" title={g.file}>
                {g.file}
              </div>
              <div className="space-y-0.5 pl-2">
                {g.refs.map((r) => (
                  <button
                    key={r.node.id}
                    type="button"
                    data-testid="reference-row"
                    onClick={() => jump(r.node.id)}
                    className="w-full text-left flex items-center gap-2 rounded px-2 py-1 hover:bg-elevated/60 transition-colors group"
                    title={`Jump to ${r.node.name}${r.node.lineRange ? ` (line ${r.node.lineRange[0]})` : ""}`}
                  >
                    <span
                      className={`text-[9px] font-semibold uppercase shrink-0 ${
                        r.kind === "calls" ? "text-accent" : "text-node-schema"
                      }`}
                    >
                      {r.kind === "calls" ? "▲ call" : "⇲ import"}
                    </span>
                    <span className="text-[11px] font-mono text-text-primary truncate flex-1 group-hover:text-accent">
                      {r.node.name}
                    </span>
                    {r.node.lineRange && (
                      <span className="text-[10px] font-mono text-text-muted shrink-0">:{r.node.lineRange[0]}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

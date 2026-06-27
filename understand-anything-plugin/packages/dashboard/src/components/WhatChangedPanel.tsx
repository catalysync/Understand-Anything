// Item 197: a "What changed" cross-view summary. Lives next to the DiffToggle.
// Lists the changed entities grouped by the view that best surfaces them
// (Structural files/symbols · Domain flows · the trace-able call paths), each
// click-through pre-filtered: clicking a structural entity focuses it, a domain
// flow opens that flow, a function offers a trace.

import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";

interface ChangedItem {
  nodeId: string;
  name: string;
  type: string;
  onClick: () => void;
}

export default function WhatChangedPanel() {
  const diffMode = useDashboardStore((s) => s.diffMode);
  const changedNodeIds = useDashboardStore((s) => s.changedNodeIds);
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const nodeIdToDomainStep = useDashboardStore((s) => s.nodeIdToDomainStep);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);

  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const structural: ChangedItem[] = [];
    const traceable: ChangedItem[] = [];
    const domainFlows = new Map<string, ChangedItem>();

    if (graph) {
      const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
      for (const id of changedNodeIds) {
        const node = byId.get(id);
        if (!node) continue;
        // A changed function/class is a candidate trace root.
        if (node.type === "function" || node.type === "class") {
          traceable.push({
            nodeId: id,
            name: node.name,
            type: node.type,
            onClick: () => startTraceAt(id),
          });
        } else {
          structural.push({
            nodeId: id,
            name: node.name,
            type: node.type,
            onClick: () => focusEntity(id, { view: "structural" }),
          });
        }
        // If this changed node maps to a domain step, surface its flow once.
        const ref = nodeIdToDomainStep.get(id);
        if (ref && !domainFlows.has(ref.flowId)) {
          domainFlows.set(ref.flowId, {
            nodeId: ref.flowId,
            name: ref.flowName,
            type: "flow",
            onClick: () => {
              navigateToDomain(ref.domainId);
              useDashboardStore.setState({ selectedNodeId: ref.flowId });
            },
          });
        }
      }
    }

    return {
      structural,
      traceable,
      domain: Array.from(domainFlows.values()),
    };
  }, [
    changedNodeIds,
    graph,
    domainGraph,
    nodeIdToDomainStep,
    focusEntity,
    startTraceAt,
    navigateToDomain,
  ]);

  if (!diffMode || changedNodeIds.size === 0) return null;

  const total =
    groups.structural.length + groups.traceable.length + groups.domain.length;

  const section = (title: string, items: ChangedItem[]) =>
    items.length === 0 ? null : (
      <div className="py-1.5">
        <div className="px-3 text-[9px] uppercase tracking-wider text-text-muted/70 mb-1">
          {title} · {items.length}
        </div>
        {items.slice(0, 30).map((it) => (
          <button
            key={`${title}-${it.nodeId}`}
            type="button"
            onClick={() => {
              it.onClick();
              setOpen(false);
            }}
            className="w-full text-left flex items-center gap-2 px-3 py-1 hover:bg-elevated/60 transition-colors"
          >
            <span className="text-[8px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0 text-center">
              {it.type}
            </span>
            <span className="text-[12px] font-mono text-text-primary truncate">
              {it.name}
            </span>
          </button>
        ))}
      </div>
    );

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="what-changed-toggle"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-0.5 rounded text-[11px] font-medium bg-elevated text-text-secondary hover:text-text-primary transition-colors"
        title="What changed — changed entities grouped by view"
      >
        What changed ({groups.structural.length + groups.traceable.length}f ·{" "}
        {groups.domain.length}fl)
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-40 w-72 max-h-[60vh] overflow-auto rounded-lg border border-border-medium bg-surface shadow-2xl"
          data-testid="what-changed-panel"
        >
          <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
            <span className="text-[11px] font-semibold text-text-primary">
              {total} changed
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-text-muted hover:text-text-primary text-xs"
            >
              ✕
            </button>
          </div>
          {total === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-text-muted">
              No changed entities in the loaded graph.
            </div>
          ) : (
            <>
              {section("Structural", groups.structural)}
              {section("Trace these", groups.traceable)}
              {section("Domain flows", groups.domain)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

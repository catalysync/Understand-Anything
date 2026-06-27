import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import TableNode from "./TableNode";
import type { TableFlowNode, TableNodeColumn } from "./TableNode";
import { useDashboardStore } from "../store";
import { mergeElkPositions, nodesToElkInput } from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import { buildErd, dataConsumers } from "../utils/opsLayer";

const nodeTypes = { "table-node": TableNode };

/**
 * 300-series items 61-64: the "Data" view — an ER diagram of `table` nodes with
 * their `column` fields and `foreign_key`/`inferred_fk` edges. Reuses the graph
 * canvas + ELK layout. Empty-states cleanly when no `table` nodes exist yet.
 */
function DataViewInner() {
  const graph = useDashboardStore((s) => s.graph);
  const attrLevel = useDashboardStore((s) => s.erdAttrLevel);
  const setAttrLevel = useDashboardStore((s) => s.setErdAttrLevel);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const focusEntity = useDashboardStore((s) => s.focusEntity);

  const erd = useMemo(() => buildErd(graph), [graph]);

  // Column → owning table, for selection-driven detail.
  const selectedColumnConsumers = useMemo(() => {
    if (!graph || !selectedNodeId) return null;
    const node = graph.nodes.find((n) => n.id === selectedNodeId);
    if (!node || (node.type !== "column" && node.type !== "table")) return null;
    return { node, consumers: dataConsumers(graph, selectedNodeId) };
  }, [graph, selectedNodeId]);

  const built = useMemo(() => {
    const dims = new Map<string, { width: number; height: number }>();
    const rfNodes: TableFlowNode[] = erd.tables.map((t) => {
      const columns: TableNodeColumn[] = t.columns.map((c) => ({
        id: c.node.id,
        name: c.node.name,
        dataType: typeof c.node.attrs?.dataType === "string" ? (c.node.attrs.dataType as string) : undefined,
        isPk: c.isPk,
        isFk: c.isFk,
        isKey: c.isKey,
      }));
      // Estimate height from visible rows for ELK spacing.
      const visibleRows =
        attrLevel === "names" ? 0 : attrLevel === "keys" ? columns.filter((c) => c.isKey).length : columns.length;
      const height = 40 + visibleRows * 22 + (visibleRows === 0 && columns.length > 0 && attrLevel !== "names" ? 22 : 0);
      dims.set(t.node.id, { width: 240, height: Math.max(60, height) });
      return {
        id: t.node.id,
        type: "table-node" as const,
        position: { x: 0, y: 0 },
        data: {
          label: t.node.name,
          columns,
          attrLevel,
          isSelected: selectedNodeId === t.node.id,
          columnCount: columns.length,
          onSelectTable: (id: string) => selectNode(id),
          onSelectColumn: (id: string) => selectNode(id),
        },
      };
    });

    const rfEdges: Edge[] = [];
    const seen = new Set<string>();
    erd.fks.forEach((fk, i) => {
      const from = fk.fromTable;
      const to = fk.toTable;
      if (!from || !to || from === to) return;
      const key = `${from}->${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      rfEdges.push({
        id: `fk-${i}-${from}-${to}`,
        source: from,
        target: to,
        animated: false,
        style: {
          stroke: fk.inferred ? "var(--color-border-medium)" : "var(--color-node-table)",
          strokeWidth: 1.5,
          strokeDasharray: fk.inferred ? "4 3" : undefined,
        },
        label: fk.inferred ? "fk?" : "fk",
        labelStyle: { fill: "var(--color-text-muted)", fontSize: 9 },
        labelBgStyle: { fill: "var(--color-surface)" },
      });
    });

    return { nodes: rfNodes as unknown as Node[], edges: rfEdges, dims };
  }, [erd, attrLevel, selectedNodeId, selectNode]);

  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });

  useEffect(() => {
    if (built.nodes.length === 0) {
      setLayout({ nodes: [], edges: [] });
      return;
    }
    let cancelled = false;
    const elkInput = nodesToElkInput(built.nodes, built.edges, built.dims, {
      "elk.direction": "RIGHT",
    });
    applyElkLayout(elkInput, { strict: false })
      .then(({ positioned }) => {
        if (cancelled) return;
        setLayout({ nodes: mergeElkPositions(built.nodes, positioned), edges: built.edges });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[data ELK] layout failed:", err);
        setLayout({ nodes: built.nodes, edges: built.edges });
      });
    return () => {
      cancelled = true;
    };
  }, [built]);

  // Empty state: no table nodes yet (graph being enriched in parallel).
  if (erd.tables.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border-medium bg-surface/80 px-8 py-7 text-center max-w-[420px]">
          <span className="text-3xl">▤</span>
          <p className="text-sm text-text-primary font-medium">No data schema yet</p>
          <p className="text-xs text-text-muted leading-relaxed">
            The Data view renders <span className="font-mono">table</span> /{" "}
            <span className="font-mono">column</span> nodes with{" "}
            <span className="font-mono">foreign_key</span> edges as an ER diagram. Once the
            graph is enriched with schema extraction (migrations / schema.rb / prisma), your
            tables will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {/* Attribute-visibility toggle (item 63) */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <div className="flex items-center bg-elevated rounded-lg p-0.5 border border-border-subtle">
          {(["all", "keys", "names"] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setAttrLevel(lvl)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors capitalize ${
                attrLevel === lvl ? "bg-node-table/20 text-node-table" : "text-text-muted hover:text-text-secondary"
              }`}
              title={
                lvl === "all" ? "Show all columns" : lvl === "keys" ? "Keys only" : "Table names only"
              }
            >
              {lvl === "names" ? "Names" : lvl === "keys" ? "Keys" : "All cols"}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-text-muted">
          {erd.tables.length} table{erd.tables.length === 1 ? "" : "s"} · {erd.fks.length} FK
        </span>
      </div>

      {/* Column/table consumers detail (item 71) */}
      {selectedColumnConsumers && (
        <div className="absolute top-3 right-3 z-10 w-[240px] rounded-lg border border-border-subtle bg-surface/95 backdrop-blur-sm p-3 shadow-xl">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-node-table mb-1">
            {selectedColumnConsumers.node.type === "table" ? "Table" : "Column"} · used by
          </div>
          <div className="text-xs text-text-primary font-medium truncate mb-2" title={selectedColumnConsumers.node.name}>
            {selectedColumnConsumers.node.name}
          </div>
          {selectedColumnConsumers.consumers.length === 0 ? (
            <div className="text-[11px] text-text-muted">No code consumers found.</div>
          ) : (
            <div className="space-y-1 max-h-[40vh] overflow-auto">
              {selectedColumnConsumers.consumers.map((row) => (
                <button
                  key={row.node.id}
                  type="button"
                  onClick={() => focusEntity(row.node.id, { view: "structural" })}
                  className="w-full flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-elevated border border-border-subtle hover:border-accent/40 text-left transition-colors"
                  title={`Jump to ${row.node.name}`}
                >
                  {row.edge.access && (
                    <span className={`text-[8px] font-bold uppercase px-1 rounded ${row.edge.access === "write" ? "text-[#c97070]" : "text-node-function"}`}>
                      {row.edge.access === "write" ? "W" : "R"}
                    </span>
                  )}
                  <span className="text-text-primary truncate flex-1">{row.node.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => selectNode(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border-subtle)" />
        <Controls />
        <MiniMap nodeColor="var(--color-node-table)" maskColor="var(--glass-bg)" className="!bg-surface !border !border-border-subtle" />
      </ReactFlow>
    </div>
  );
}

export default function DataView() {
  return (
    <ReactFlowProvider>
      <DataViewInner />
    </ReactFlowProvider>
  );
}

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

// 300-series items 61-64: an ER-diagram table node. Renders the table name +
// (optionally) its columns, with key glyphs. Attribute visibility is controlled
// by the `attrLevel` flag pushed from the Data view ("all"/"keys"/"names").
export interface TableNodeColumn {
  id: string;
  name: string;
  dataType?: string;
  isPk: boolean;
  isFk: boolean;
  isKey: boolean;
}

export interface TableNodeData extends Record<string, unknown> {
  label: string;
  columns: TableNodeColumn[];
  attrLevel: "all" | "keys" | "names";
  isSelected: boolean;
  columnCount: number;
  onSelectTable?: (id: string) => void;
  onSelectColumn?: (id: string) => void;
}

export type TableFlowNode = Node<TableNodeData, "table-node">;

function TableNodeComponent({ id, data }: NodeProps<TableFlowNode>) {
  const { label, columns, attrLevel, isSelected, columnCount } = data;
  const visible =
    attrLevel === "names"
      ? []
      : attrLevel === "keys"
        ? columns.filter((c) => c.isKey)
        : columns;

  return (
    <div
      className={`rounded-lg bg-elevated border overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.35)] min-w-[180px] max-w-[260px] cursor-pointer transition-[box-shadow,outline] ${
        isSelected ? "border-node-table ring-2 ring-node-table" : "border-border-subtle hover:border-node-table/50"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-node-table !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-node-table !w-2 !h-2" />

      {/* Header */}
      <button
        type="button"
        onClick={() => data.onSelectTable?.(id)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-node-table/10 border-b border-border-subtle text-left"
        title={`Focus table ${label}`}
      >
        <span className="text-node-table shrink-0" aria-hidden>▤</span>
        <span className="text-sm font-heading text-text-primary truncate flex-1">{label}</span>
        <span className="text-[9px] font-mono text-text-muted shrink-0">{columnCount}</span>
      </button>

      {/* Columns */}
      {visible.length > 0 && (
        <div className="divide-y divide-border-subtle/50">
          {visible.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => data.onSelectColumn?.(c.id)}
              className="w-full flex items-center gap-1.5 px-3 py-1 text-left hover:bg-node-table/5 transition-colors"
              title={`Show code using ${c.name}`}
            >
              <span className="w-3 shrink-0 text-[9px] font-bold text-center" aria-hidden>
                {c.isPk ? "🔑" : c.isFk ? "↗" : ""}
              </span>
              <span className={`text-[11px] truncate flex-1 ${c.isKey ? "text-text-primary font-medium" : "text-text-secondary"}`}>
                {c.name}
              </span>
              {c.dataType && (
                <span className="text-[9px] font-mono text-text-muted shrink-0 truncate max-w-[70px]">
                  {c.dataType}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {attrLevel !== "names" && visible.length === 0 && columnCount > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-text-muted italic">
          {attrLevel === "keys" ? "no key columns" : "no columns extracted"}
        </div>
      )}
    </div>
  );
}

const TableNode = memo(TableNodeComponent);
export default TableNode;

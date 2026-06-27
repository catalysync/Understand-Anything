// 200-81: Cross-layer dependency matrix — a toggleable heatmap panel. Rows × cols
// = layers; cell = count of imports/calls edges from row-layer → col-layer. Click
// a cell → filter the graph to those edges (sets matrixCellFilter in the store;
// GraphView consumes it). Reveals coupling + layering violations (off-diagonal).
import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { buildLayerMatrix } from "../utils/vizLayout";
import { resolveLayerColor } from "../utils/layerOverrides";

export default function DependencyMatrix() {
  const open = useDashboardStore((s) => s.matrixPanelOpen);
  const setOpen = useDashboardStore((s) => s.setMatrixPanelOpen);
  const graph = useDashboardStore((s) => s.graph);
  const overrides = useDashboardStore((s) => s.layerOverrides);
  const cellFilter = useDashboardStore((s) => s.matrixCellFilter);
  const setCellFilter = useDashboardStore((s) => s.setMatrixCellFilter);

  const matrix = useMemo(() => (graph ? buildLayerMatrix(graph) : null), [graph]);

  if (!open) return null;

  const n = matrix?.layerIds.length ?? 0;
  const cellSize = n > 0 ? Math.max(18, Math.min(40, Math.floor(280 / n))) : 30;
  const labelW = 96;

  const heatFill = (count: number): string => {
    if (!matrix || count === 0) return "transparent";
    const t = matrix.max > 0 ? count / matrix.max : 0;
    const alpha = 0.12 + t * 0.7;
    return `rgba(211, 93, 110, ${alpha})`;
  };

  return (
    <div className="absolute top-4 right-4 z-20 rounded-xl border border-border-medium bg-surface/95 shadow-2xl backdrop-blur-sm max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle gap-6">
        <div>
          <div className="text-xs font-semibold text-text-primary">Cross-layer dependency matrix</div>
          <div className="text-[10px] text-text-muted">
            row → col · imports + calls · off-diagonal = coupling
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          aria-label="Close matrix panel"
        >
          ×
        </button>
      </div>

      {!matrix || n === 0 ? (
        <div className="px-5 py-10 text-center text-[11px] text-text-muted leading-relaxed w-[280px]">
          No layers to chart. Re-run <span className="font-mono">/understand</span> so the graph
          carries layer assignments.
        </div>
      ) : (
        <div className="p-3">
          {cellFilter && (
            <button
              type="button"
              onClick={() => setCellFilter(null)}
              className="mb-2 text-[10px] px-2 py-1 rounded border border-[#d35d6e]/50 bg-[#d35d6e]/10 text-[#d35d6e]"
            >
              ✕ Clear graph filter
            </button>
          )}
          <div className="overflow-auto max-w-[calc(100vw-4rem)]">
            <svg
              width={labelW + n * cellSize + 8}
              height={labelW + n * cellSize + 8}
              className="block"
            >
              {/* Column headers (rotated) */}
              {matrix.layerNames.map((name, c) => {
                const color = resolveLayerColor(overrides, matrix.layerIds[c], c);
                const x = labelW + c * cellSize + cellSize / 2;
                return (
                  <text
                    key={`col-${c}`}
                    x={x}
                    y={labelW - 6}
                    fontSize={9}
                    fill={color.label}
                    textAnchor="start"
                    transform={`rotate(-55 ${x} ${labelW - 6})`}
                  >
                    {name.length > 14 ? name.slice(0, 13) + "…" : name}
                  </text>
                );
              })}
              {/* Rows */}
              {matrix.layerNames.map((name, r) => {
                const color = resolveLayerColor(overrides, matrix.layerIds[r], r);
                return (
                  <g key={`row-${r}`}>
                    <text
                      x={labelW - 6}
                      y={labelW + r * cellSize + cellSize / 2 + 3}
                      fontSize={9}
                      fill={color.label}
                      textAnchor="end"
                    >
                      {name.length > 14 ? name.slice(0, 13) + "…" : name}
                    </text>
                    {matrix.counts[r].map((count, c) => {
                      const isDiag = r === c;
                      const active =
                        cellFilter &&
                        cellFilter[0] === matrix.layerIds[r] &&
                        cellFilter[1] === matrix.layerIds[c];
                      const x = labelW + c * cellSize;
                      const y = labelW + r * cellSize;
                      return (
                        <g key={`cell-${r}-${c}`}>
                          <rect
                            x={x + 1}
                            y={y + 1}
                            width={cellSize - 2}
                            height={cellSize - 2}
                            fill={isDiag ? "rgba(120,130,145,0.12)" : heatFill(count)}
                            stroke={active ? "#d35d6e" : "var(--color-border-subtle)"}
                            strokeWidth={active ? 2 : 0.5}
                            rx={2}
                            className={count > 0 && !isDiag ? "cursor-pointer" : ""}
                            onClick={() => {
                              if (count > 0 && !isDiag) {
                                setCellFilter(
                                  active ? null : [matrix.layerIds[r], matrix.layerIds[c]],
                                );
                              }
                            }}
                          >
                            <title>{`${matrix.layerNames[r]} → ${matrix.layerNames[c]}: ${count}`}</title>
                          </rect>
                          {count > 0 && (
                            <text
                              x={x + cellSize / 2}
                              y={y + cellSize / 2 + 3}
                              fontSize={9}
                              textAnchor="middle"
                              fill={isDiag ? "var(--color-text-muted)" : "var(--color-text-primary)"}
                              className="pointer-events-none"
                            >
                              {count}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="text-[10px] text-text-muted mt-1 px-1">
            Click an off-diagonal cell to filter the graph to those edges. Diagonal = intra-layer.
          </div>
        </div>
      )}
    </div>
  );
}

// 300-series item 48: churn × complexity hotspot quadrant.
//
// A scatter of git-enriched file nodes: X = churn, Y = complexity, bubble size
// = LOC (from lineRange, with a degree-free fallback). The upper-right quadrant
// (high churn + high complexity) is the refactor-priority zone. Clicking a point
// focuses the node. Reachable from a toolbar button; renders as a floating panel.
import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { buildHotspotData } from "../utils/gitMeta";
import type { HotspotPoint } from "../utils/gitMeta";

const W = 460;
const H = 320;
const PAD_L = 44;
const PAD_B = 36;
const PAD_T = 16;
const PAD_R = 16;

const COMPLEXITY_LABEL = ["simple", "moderate", "complex"];

export default function HotspotQuadrant() {
  const open = useDashboardStore((s) => s.hotspotPanelOpen);
  const setOpen = useDashboardStore((s) => s.setHotspotPanelOpen);
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const [hover, setHover] = useState<HotspotPoint | null>(null);

  const data = useMemo(() => buildHotspotData(graph), [graph]);

  if (!open) return null;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const maxChurn = Math.max(1, data.maxChurn);

  // X = churn (log-ish linear), Y inverted so complex is on top.
  const xOf = (churn: number) => PAD_L + (churn / maxChurn) * plotW;
  const yOf = (rank: number) => PAD_T + (1 - rank / 2) * plotH;

  // LOC → radius (sqrt scale); fallback radius when LOC unknown.
  const maxLoc = data.points.reduce((m, p) => Math.max(m, p.loc ?? 0), 0) || 1;
  const rOf = (loc: number | null) => {
    if (loc === null) return 4;
    return 3 + Math.sqrt(loc / maxLoc) * 9;
  };

  const churnSplitX = xOf(data.churnSplit);
  const complexitySplitY = yOf(data.complexitySplit);
  const priorityCount = data.points.filter((p) => p.priority).length;

  return (
    <div className="absolute bottom-4 right-4 z-20 rounded-xl border border-border-medium bg-surface/95 shadow-2xl backdrop-blur-sm w-[492px] max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
        <div>
          <div className="text-xs font-semibold text-text-primary">Churn × Complexity hotspots</div>
          <div className="text-[10px] text-text-muted">
            Upper-right = refactor priority ({priorityCount} flagged)
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          aria-label="Close hotspot panel"
        >
          ×
        </button>
      </div>

      {data.points.length === 0 ? (
        <div className="px-5 py-10 text-center text-[11px] text-text-muted leading-relaxed">
          No git-enriched nodes to plot. Re-run <span className="font-mono">/understand</span> with
          git enrichment so file nodes carry <span className="font-mono">churn</span> + complexity.
        </div>
      ) : (
        <div className="p-3">
          <svg width={W} height={H} className="max-w-full">
            {/* Refactor-priority quadrant shading (upper-right). */}
            <rect
              x={churnSplitX}
              y={PAD_T}
              width={PAD_L + plotW - churnSplitX}
              height={complexitySplitY - PAD_T}
              fill="#c97070"
              opacity={0.08}
            />
            {/* Quadrant split lines. */}
            <line x1={churnSplitX} y1={PAD_T} x2={churnSplitX} y2={PAD_T + plotH} stroke="var(--color-border-medium)" strokeDasharray="3 3" />
            <line x1={PAD_L} y1={complexitySplitY} x2={PAD_L + plotW} y2={complexitySplitY} stroke="var(--color-border-medium)" strokeDasharray="3 3" />
            {/* Axes. */}
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke="var(--color-border-subtle)" />
            <line x1={PAD_L} y1={PAD_T + plotH} x2={PAD_L + plotW} y2={PAD_T + plotH} stroke="var(--color-border-subtle)" />

            {/* Y ticks (complexity). */}
            {[0, 1, 2].map((rank) => (
              <text key={rank} x={PAD_L - 6} y={yOf(rank) + 3} textAnchor="end" fontSize={9} fill="var(--color-text-muted)">
                {COMPLEXITY_LABEL[rank]}
              </text>
            ))}
            {/* X ticks (churn). */}
            {[0, Math.round(maxChurn / 2), maxChurn].map((c, i) => (
              <text key={i} x={xOf(c)} y={PAD_T + plotH + 14} textAnchor="middle" fontSize={9} fill="var(--color-text-muted)">
                {c}
              </text>
            ))}
            <text x={PAD_L + plotW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--color-text-muted)">churn (commits)</text>

            {/* Points. */}
            {data.points.map((p) => {
              const cx = xOf(p.churn);
              const cy = yOf(p.complexityRank);
              const r = rOf(p.loc);
              return (
                <circle
                  key={p.id}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={p.priority ? "#c97070" : "#d4a574"}
                  fillOpacity={p.priority ? 0.85 : 0.5}
                  stroke={p.busFactor === 1 ? "#d35d6e" : "transparent"}
                  strokeWidth={p.busFactor === 1 ? 1.5 : 0}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(p)}
                  onMouseLeave={() => setHover((h) => (h?.id === p.id ? null : h))}
                  onClick={() => {
                    focusEntity(p.id, { view: "structural" });
                    setOpen(false);
                  }}
                />
              );
            })}
          </svg>

          {/* Hover tooltip + legend. */}
          <div className="flex items-start justify-between gap-3 mt-1 px-1">
            <div className="text-[10px] text-text-secondary min-h-[28px] flex-1">
              {hover ? (
                <span>
                  <span className="font-semibold text-text-primary">{hover.name}</span>
                  {" — "}churn {hover.churn}, {hover.complexity}
                  {hover.loc !== null ? `, ${hover.loc} LOC` : ""}
                  {hover.owner ? `, ${hover.owner}` : ""}
                  {hover.busFactor === 1 ? " (single-owner)" : ""}
                </span>
              ) : (
                <span className="text-text-muted">Hover a bubble for detail · click to focus the node · bubble = LOC · red ring = single-owner</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[9px] text-text-muted shrink-0">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#c97070" }} />priority</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#d4a574", opacity: 0.5 }} />other</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

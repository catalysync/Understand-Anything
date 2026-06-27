// 300-42: Metric treemap — containment-hierarchy treemap (folders/layers → files).
// Node size = LOC (or node-count); color = a chosen metric (coverage / complexity /
// churn) via a dropdown. Click a folder drills down; click the innermost / a leaf
// focuses; a breadcrumb / "ascend" button climbs back up. The "size = quantity,
// color = quality" widget. Reuses the HotspotQuadrant floating-panel shell.
import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import {
  buildHierarchy,
  buildMetricResolver,
  squarify,
  VIZ_METRIC_LABEL,
  type HierNode,
  type VizMetric,
} from "../utils/vizLayout";

const W = 460;
const H = 320;

export default function MetricTreemap() {
  const open = useDashboardStore((s) => s.treemapPanelOpen);
  const setOpen = useDashboardStore((s) => s.setTreemapPanelOpen);
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);

  const [metric, setMetric] = useState<VizMetric>("complexity");
  const [sizeMode, setSizeMode] = useState<"loc" | "count">("loc");
  // Drill path: array of folder ids from root. [] = root.
  const [path, setPath] = useState<string[]>([]);
  const [hover, setHover] = useState<HierNode | null>(null);

  const resolver = useMemo(
    () => (graph ? buildMetricResolver(graph, metric) : null),
    [graph, metric],
  );

  const root = useMemo(
    () => (graph && resolver ? buildHierarchy(graph, resolver, sizeMode) : null),
    [graph, resolver, sizeMode],
  );

  // Navigate to the current drill node.
  const current = useMemo(() => {
    if (!root) return null;
    let cur: HierNode = root;
    for (const seg of path) {
      const next = cur.children.find((c) => !c.isLeaf && c.id === seg);
      if (!next) break;
      cur = next;
    }
    return cur;
  }, [root, path]);

  const tiles = useMemo(
    () => (current ? squarify(current, 0, 0, W, H) : []),
    [current],
  );

  const crumbs = useMemo(() => {
    if (!root) return [];
    const out: { id: string; name: string; depth: number }[] = [{ id: "", name: "root", depth: 0 }];
    let cur: HierNode = root;
    for (let i = 0; i < path.length; i++) {
      const next = cur.children.find((c) => !c.isLeaf && c.id === path[i]);
      if (!next) break;
      out.push({ id: next.id, name: next.name, depth: i + 1 });
      cur = next;
    }
    return out;
  }, [root, path]);

  if (!open) return null;

  return (
    <div className="absolute bottom-4 right-4 z-20 rounded-xl border border-border-medium bg-surface/95 shadow-2xl backdrop-blur-sm w-[492px] max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
        <div>
          <div className="text-xs font-semibold text-text-primary">Metric treemap</div>
          <div className="text-[10px] text-text-muted">
            Size = {sizeMode === "loc" ? "LOC" : "file count"} · color = {VIZ_METRIC_LABEL[metric]}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          aria-label="Close treemap panel"
        >
          ×
        </button>
      </div>

      {!root || root.children.length === 0 ? (
        <div className="px-5 py-10 text-center text-[11px] text-text-muted leading-relaxed">
          No file nodes with paths to map. Re-run <span className="font-mono">/understand</span> so
          file nodes carry <span className="font-mono">filePath</span> + <span className="font-mono">lineRange</span>.
        </div>
      ) : (
        <div className="p-3">
          {/* Controls */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as VizMetric)}
              className="text-[10px] bg-elevated border border-border-medium rounded px-1.5 py-1 text-text-secondary"
            >
              {(["coverage", "complexity", "churn"] as VizMetric[]).map((m) => (
                <option key={m} value={m}>{VIZ_METRIC_LABEL[m]}</option>
              ))}
            </select>
            <div className="flex items-center rounded border border-border-medium overflow-hidden">
              {(["loc", "count"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSizeMode(m)}
                  className={`text-[10px] px-2 py-1 ${sizeMode === m ? "bg-accent/15 text-accent" : "bg-elevated text-text-muted hover:text-text-secondary"}`}
                >
                  {m === "loc" ? "LOC" : "#files"}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={path.length === 0}
              onClick={() => setPath((p) => p.slice(0, -1))}
              className="text-[10px] px-2 py-1 rounded border border-border-medium bg-elevated text-text-muted hover:text-text-secondary disabled:opacity-30"
            >
              ↑ Ascend
            </button>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 mb-1.5 text-[10px] text-text-muted flex-wrap">
            {crumbs.map((c, i) => (
              <span key={c.id || "root"} className="flex items-center gap-1">
                {i > 0 && <span className="text-text-muted/50">/</span>}
                <button
                  type="button"
                  onClick={() => setPath(path.slice(0, c.depth))}
                  className="hover:text-text-primary"
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>

          <svg width={W} height={H} className="max-w-full rounded border border-border-subtle">
            {tiles.map((t) => {
              const c = resolver!.color(t.node.metric);
              return (
                <g
                  key={t.node.id}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(t.node)}
                  onMouseLeave={() => setHover((h) => (h?.id === t.node.id ? null : h))}
                  onClick={() => {
                    if (t.node.isLeaf && t.node.nodeId) {
                      focusEntity(t.node.nodeId, { view: "structural" });
                      setOpen(false);
                    } else if (!t.node.isLeaf) {
                      setPath((p) => [...p, t.node.id]);
                    }
                  }}
                >
                  <rect
                    x={t.x + 0.5}
                    y={t.y + 0.5}
                    width={Math.max(0, t.w - 1)}
                    height={Math.max(0, t.h - 1)}
                    fill={c}
                    fillOpacity={t.node.isLeaf ? 0.85 : 0.55}
                    stroke="rgba(0,0,0,0.35)"
                    strokeWidth={t.node.isLeaf ? 0.5 : 1}
                  />
                  {t.w > 38 && t.h > 14 && (
                    <text
                      x={t.x + 3}
                      y={t.y + 11}
                      fontSize={9}
                      fill="rgba(20,20,20,0.85)"
                      className="pointer-events-none"
                    >
                      {t.node.name.length > t.w / 6 ? t.node.name.slice(0, Math.floor(t.w / 6)) + "…" : t.node.name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          <div className="text-[10px] text-text-secondary min-h-[28px] mt-1 px-1">
            {hover ? (
              <span>
                <span className="font-semibold text-text-primary">{hover.name}</span>
                {" — "}
                {hover.isLeaf ? "file" : `${hover.children.length} items`}
                {", "}{sizeMode === "loc" ? `${hover.size} LOC` : `${hover.size} files`}
                {hover.metric !== null ? `, ${VIZ_METRIC_LABEL[metric]} ${(hover.metric * 100).toFixed(0)}%` : ""}
              </span>
            ) : (
              <span className="text-text-muted">Click a folder to drill in · click a file to focus · ↑ to ascend · green→red = {VIZ_METRIC_LABEL[metric]}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

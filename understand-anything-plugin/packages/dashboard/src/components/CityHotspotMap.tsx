// 300-50: Circle-packing "city" hotspot map — an enclosure diagram. Folders nest
// as circles, circle size = LOC, color = a health score (complexity × churn, or
// 1−coverage). Click a folder → focus (drill in); click a leaf → focus its node.
// A second whole-repo lens beside the treemap. Reuses the floating-panel shell.
import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import {
  buildHierarchy,
  buildMetricResolver,
  packChildren,
  type HierNode,
} from "../utils/vizLayout";

const SIZE = 360;

export default function CityHotspotMap() {
  const open = useDashboardStore((s) => s.cityPanelOpen);
  const setOpen = useDashboardStore((s) => s.setCityPanelOpen);
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);

  const [path, setPath] = useState<string[]>([]);
  const [hover, setHover] = useState<HierNode | null>(null);

  // Health score: combine complexity + churn (use complexity resolver as base,
  // but we want a composite — build both and average). Simpler: use complexity
  // metric as the dominant "health" hue; the treemap covers the per-metric lens.
  const resolver = useMemo(
    () => (graph ? buildMetricResolver(graph, "complexity") : null),
    [graph],
  );
  const churnResolver = useMemo(
    () => (graph ? buildMetricResolver(graph, "churn") : null),
    [graph],
  );

  const root = useMemo(
    () => (graph && resolver ? buildHierarchy(graph, resolver, "loc") : null),
    [graph, resolver],
  );

  // Composite health per folder/leaf = max(complexity, churn) metric where available.
  const churnRoot = useMemo(
    () => (graph && churnResolver ? buildHierarchy(graph, churnResolver, "loc") : null),
    [graph, churnResolver],
  );
  const churnByPath = useMemo(() => {
    const m = new Map<string, number | null>();
    const walk = (n: HierNode | null) => {
      if (!n) return;
      m.set(n.id, n.metric);
      n.children.forEach(walk);
    };
    walk(churnRoot);
    return m;
  }, [churnRoot]);

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

  const circles = useMemo(
    () => (current ? packChildren(current, SIZE / 2, SIZE / 2, SIZE / 2 - 6) : []),
    [current],
  );

  // Health color = blend of complexity + churn (both 0..1), use the heat via resolver.
  const healthColor = (n: HierNode): string => {
    const comp = n.metric;
    const ch = churnByPath.get(n.id) ?? null;
    const both = [comp, ch].filter((v): v is number => v !== null);
    if (both.length === 0) return "rgba(120,130,145,0.4)";
    const score = both.reduce((a, b) => a + b, 0) / both.length;
    return resolver!.color(score);
  };

  if (!open) return null;

  return (
    <div className="absolute bottom-4 right-4 z-20 rounded-xl border border-border-medium bg-surface/95 shadow-2xl backdrop-blur-sm w-[420px] max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
        <div>
          <div className="text-xs font-semibold text-text-primary">Circle-packing city map</div>
          <div className="text-[10px] text-text-muted">
            Circle = LOC · color = health (complexity × churn)
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          aria-label="Close city map panel"
        >
          ×
        </button>
      </div>

      {!root || root.children.length === 0 ? (
        <div className="px-5 py-10 text-center text-[11px] text-text-muted leading-relaxed">
          No file nodes with paths to pack. Re-run <span className="font-mono">/understand</span>.
        </div>
      ) : (
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              disabled={path.length === 0}
              onClick={() => setPath((p) => p.slice(0, -1))}
              className="text-[10px] px-2 py-1 rounded border border-border-medium bg-elevated text-text-muted hover:text-text-secondary disabled:opacity-30"
            >
              ↑ Up
            </button>
            <span className="text-[10px] text-text-muted truncate">
              {path.length === 0 ? "root" : "…/" + path[path.length - 1].split("/").pop()}
            </span>
          </div>

          <svg width={SIZE} height={SIZE} className="max-w-full block mx-auto">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 4} fill="rgba(255,255,255,0.02)" stroke="var(--color-border-subtle)" />
            {circles.map((c) => (
              <g
                key={c.node.id}
                className="cursor-pointer"
                onMouseEnter={() => setHover(c.node)}
                onMouseLeave={() => setHover((h) => (h?.id === c.node.id ? null : h))}
                onClick={() => {
                  if (c.node.isLeaf && c.node.nodeId) {
                    focusEntity(c.node.nodeId, { view: "structural" });
                    setOpen(false);
                  } else if (!c.node.isLeaf) {
                    setPath((p) => [...p, c.node.id]);
                  }
                }}
              >
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={c.r}
                  fill={healthColor(c.node)}
                  fillOpacity={c.node.isLeaf ? 0.8 : 0.45}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth={c.node.isLeaf ? 0.5 : 1.2}
                />
                {c.r > 16 && (
                  <text
                    x={c.x}
                    y={c.y + 3}
                    fontSize={Math.min(10, c.r / 2)}
                    textAnchor="middle"
                    fill="rgba(15,15,15,0.85)"
                    className="pointer-events-none"
                  >
                    {c.node.name.length > 10 ? c.node.name.slice(0, 9) + "…" : c.node.name}
                  </text>
                )}
              </g>
            ))}
          </svg>

          <div className="text-[10px] text-text-secondary min-h-[28px] mt-1 px-1">
            {hover ? (
              <span>
                <span className="font-semibold text-text-primary">{hover.name}</span>
                {" — "}{hover.isLeaf ? "file" : `${hover.children.length} items`}, {hover.size} LOC
              </span>
            ) : (
              <span className="text-text-muted">Click to focus / drill · red = high complexity × churn</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

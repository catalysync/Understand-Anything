// Visualization & structural-polish tier — shared compute helpers.
//
// Pure (graph → layout) functions for:
//   • Metric treemap         (300-42) — containment hierarchy → squarified tiles
//   • Circle-packing city    (300-50) — nested circles by LOC, colored by health
//   • Cross-layer matrix     (200-81) — layer×layer imports/calls edge counts
//   • Reading-order BFS       (200-156) — book-order file walk from entrypoints
//
// Plus a chosen-metric resolver shared by treemap + circle-packing so
// "size = quantity, color = quality" is consistent across both lenses.
import type { GraphNode, GraphEdge, KnowledgeGraph } from "@understand-anything/core/types";
import { gitMetaFor } from "./gitMeta";

// ── Metric model (color = quality) ──────────────────────────────────────────

export type VizMetric = "coverage" | "complexity" | "churn";

export const VIZ_METRIC_LABEL: Record<VizMetric, string> = {
  coverage: "Coverage %",
  complexity: "Complexity",
  churn: "Churn",
};

const COMPLEXITY_RANK: Record<string, number> = { simple: 0, moderate: 1, complex: 2 };

const COVERS_EDGE = new Set<string>(["covers", "tested_by"]);

/** node id → fraction [0..1] of "covered" (has ≥1 covering test edge). Per-node binary, used for treemap rollups. */
function buildCoveredSet(graph: KnowledgeGraph): Set<string> {
  const covered = new Set<string>();
  for (const e of graph.edges) {
    if (!COVERS_EDGE.has(e.type)) continue;
    // covers: test→code ; tested_by: code→test. Mark the code endpoint.
    covered.add(e.source);
    covered.add(e.target);
  }
  return covered;
}

/** LOC for a node from lineRange, else null. */
export function locOf(node: GraphNode): number | null {
  const lr = node.lineRange;
  if (Array.isArray(lr) && lr.length === 2 && Number.isFinite(lr[0]) && Number.isFinite(lr[1])) {
    return Math.max(1, lr[1] - lr[0] + 1);
  }
  return null;
}

export interface MetricResolver {
  /** Per-node raw metric value in [0..1] (already normalized), or null if N/A. */
  value: (node: GraphNode) => number | null;
  /** Map a [0..1] metric to a heat color (green→amber→red); coverage is inverted so high coverage = green. */
  color: (v: number | null) => string;
}

function heat(v: number): string {
  // 0 green → 0.5 amber → 1 red
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.5) {
    const k = t / 0.5;
    return lerpColor([90, 158, 111], [201, 160, 108], k);
  }
  const k = (t - 0.5) / 0.5;
  return lerpColor([201, 160, 108], [201, 112, 112], k);
}

function lerpColor(a: number[], b: number[], k: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return `rgb(${r}, ${g}, ${bl})`;
}

export function buildMetricResolver(graph: KnowledgeGraph, metric: VizMetric): MetricResolver {
  const maxChurn = (() => {
    let m = 0;
    for (const n of graph.nodes) {
      const meta = gitMetaFor(n);
      if (meta && meta.churn > m) m = meta.churn;
    }
    return m || 1;
  })();
  const covered = metric === "coverage" ? buildCoveredSet(graph) : null;

  const value = (node: GraphNode): number | null => {
    if (metric === "complexity") {
      const r = COMPLEXITY_RANK[node.complexity];
      return r === undefined ? null : r / 2;
    }
    if (metric === "churn") {
      const meta = gitMetaFor(node);
      if (!meta) return null;
      return Math.min(1, meta.churn / maxChurn);
    }
    // coverage — 1 = covered (good). Color inverts below.
    if (!covered) return null;
    return covered.has(node.id) ? 1 : 0;
  };

  const color = (v: number | null): string => {
    if (v === null) return "rgba(120,130,145,0.35)";
    // coverage: high = good = green → invert before heat.
    const heatVal = metric === "coverage" ? 1 - v : v;
    return heat(heatVal);
  };

  return { value, color };
}

// ── Containment hierarchy (folders → files) ─────────────────────────────────

export interface HierNode {
  id: string;          // path key (folder) or node id (leaf)
  name: string;        // display label (last path segment)
  isLeaf: boolean;
  nodeId?: string;     // graph node id when leaf
  size: number;        // LOC (leaf) or summed (folder)
  /** Average metric over leaves under this node, weighted by size. null if no data. */
  metric: number | null;
  children: HierNode[];
}

/** Eligible file-like nodes for the containment lenses. */
const FILE_TYPES = new Set<string>(["file", "module"]);

function pathOf(node: GraphNode): string | null {
  const p = node.filePath;
  if (typeof p === "string" && p.length > 0) return p;
  return null;
}

/**
 * Build a folder→file containment tree from file nodes' filePath segments.
 * sizeMode "loc" → leaf size = LOC (fallback 1); "count" → leaf size = 1.
 */
export function buildHierarchy(
  graph: KnowledgeGraph,
  resolver: MetricResolver,
  sizeMode: "loc" | "count",
): HierNode {
  const root: HierNode = { id: "", name: "root", isLeaf: false, size: 0, metric: null, children: [] };

  const fileNodes = graph.nodes.filter((n) => FILE_TYPES.has(n.type) && pathOf(n) !== null);

  for (const node of fileNodes) {
    const path = pathOf(node)!;
    const segs = path.split("/").filter(Boolean);
    if (segs.length === 0) continue;
    let cur = root;
    let acc = "";
    for (let i = 0; i < segs.length - 1; i++) {
      acc = acc ? `${acc}/${segs[i]}` : segs[i];
      let child = cur.children.find((c) => !c.isLeaf && c.id === acc);
      if (!child) {
        child = { id: acc, name: segs[i], isLeaf: false, size: 0, metric: null, children: [] };
        cur.children.push(child);
      }
      cur = child;
    }
    const loc = locOf(node);
    const leafSize = sizeMode === "count" ? 1 : Math.max(1, loc ?? 1);
    const mv = resolver.value(node);
    cur.children.push({
      id: node.id,
      name: segs[segs.length - 1],
      isLeaf: true,
      nodeId: node.id,
      size: leafSize,
      metric: mv,
      children: [],
    });
  }

  // Roll up sizes + size-weighted metric.
  const rollup = (n: HierNode): { size: number; mSum: number; mWeight: number } => {
    if (n.isLeaf) {
      const has = n.metric !== null;
      return { size: n.size, mSum: has ? n.metric! * n.size : 0, mWeight: has ? n.size : 0 };
    }
    let size = 0, mSum = 0, mWeight = 0;
    for (const c of n.children) {
      const r = rollup(c);
      size += r.size;
      mSum += r.mSum;
      mWeight += r.mWeight;
    }
    n.size = size;
    n.metric = mWeight > 0 ? mSum / mWeight : null;
    return { size, mSum, mWeight };
  };
  rollup(root);
  return root;
}

// ── Squarified treemap layout ───────────────────────────────────────────────

export interface TreeTile {
  node: HierNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap of a node's direct children inside the given rect. */
export function squarify(parent: HierNode, x: number, y: number, w: number, h: number): TreeTile[] {
  const children = parent.children.filter((c) => c.size > 0);
  if (children.length === 0) return [];
  const total = children.reduce((s, c) => s + c.size, 0);
  if (total <= 0) return [];

  const tiles: TreeTile[] = [];
  // Greedy row packing (squarified-ish).
  const items = children
    .map((c) => ({ node: c, area: (c.size / total) * w * h }))
    .sort((a, b) => b.area - a.area);

  let cx = x, cy = y, cw = w, ch = h;
  let i = 0;
  while (i < items.length) {
    const horizontal = cw >= ch;
    const side = horizontal ? ch : cw;
    // Build a row that keeps aspect ratios reasonable.
    const row: typeof items = [];
    let rowArea = 0;
    let bestRatio = Infinity;
    while (i < items.length) {
      const next = [...row, items[i]];
      const a = rowArea + items[i].area;
      const ratio = worstRatio(next.map((n) => n.area), side, a);
      if (ratio > bestRatio && row.length > 0) break;
      bestRatio = ratio;
      row.push(items[i]);
      rowArea = a;
      i++;
    }
    const rowThick = side > 0 ? rowArea / side : 0;
    let pos = horizontal ? cy : cx;
    for (const it of row) {
      const len = rowArea > 0 ? (it.area / rowArea) * side : 0;
      if (horizontal) {
        tiles.push({ node: it.node, x: cx, y: pos, w: rowThick, h: len });
      } else {
        tiles.push({ node: it.node, x: pos, y: cy, w: len, h: rowThick });
      }
      pos += len;
    }
    if (horizontal) {
      cx += rowThick;
      cw -= rowThick;
    } else {
      cy += rowThick;
      ch -= rowThick;
    }
    if (cw <= 0 || ch <= 0) break;
  }
  return tiles;
}

function worstRatio(areas: number[], side: number, total: number): number {
  if (total <= 0 || side <= 0) return Infinity;
  const thick = total / side;
  let worst = 0;
  for (const a of areas) {
    const len = a / thick;
    const r = Math.max(thick / Math.max(len, 1e-9), len / Math.max(thick, 1e-9));
    if (r > worst) worst = r;
  }
  return worst;
}

// ── Circle-packing (nested enclosure) ───────────────────────────────────────

export interface PackCircle {
  node: HierNode;
  x: number;
  y: number;
  r: number;
}

/**
 * Simple deterministic nested circle pack: a parent circle of radius R holds
 * its children laid out on a spiral/grid sized by sqrt(size). Not optimal,
 * but stable + readable for a "city" lens.
 */
export function packChildren(parent: HierNode, cx: number, cy: number, R: number): PackCircle[] {
  const children = parent.children.filter((c) => c.size > 0);
  if (children.length === 0) return [];
  const total = children.reduce((s, c) => s + c.size, 0);
  // child radius proportional to sqrt(area share) of available area.
  const avail = Math.PI * R * R * 0.62;
  const scaled = children.map((c) => {
    const area = (c.size / total) * avail;
    return { node: c, r: Math.max(4, Math.sqrt(area / Math.PI)) };
  });
  scaled.sort((a, b) => b.r - a.r);

  // Greedy spiral placement with overlap avoidance.
  const placed: PackCircle[] = [];
  for (const s of scaled) {
    let best: PackCircle | null = null;
    const steps = 240;
    for (let k = 0; k < steps; k++) {
      const ang = k * 2.39996; // golden angle
      const rad = (R - s.r) * Math.sqrt(k / steps);
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      // inside parent?
      if (Math.hypot(px - cx, py - cy) + s.r > R) continue;
      // overlap?
      let ok = true;
      for (const p of placed) {
        if (Math.hypot(px - p.x, py - p.y) < p.r + s.r + 1.5) { ok = false; break; }
      }
      if (ok) { best = { node: s.node, x: px, y: py, r: s.r }; break; }
    }
    if (best) placed.push(best);
    else placed.push({ node: s.node, x: cx, y: cy, r: s.r }); // fallback center
  }
  return placed;
}

// ── Cross-layer dependency matrix (200-81) ──────────────────────────────────

const DEP_EDGE_TYPES = new Set<string>(["imports", "calls"]);

export interface LayerMatrix {
  layerIds: string[];
  layerNames: string[];
  /** counts[row][col] = #edges from row-layer → col-layer (imports/calls). */
  counts: number[][];
  max: number;
}

export function buildLayerMatrix(graph: KnowledgeGraph): LayerMatrix {
  const layers = graph.layers ?? [];
  const idx = new Map<string, number>();
  layers.forEach((l, i) => idx.set(l.id, i));
  const nodeToLayer = new Map<string, string>();
  for (const l of layers) for (const id of l.nodeIds) nodeToLayer.set(id, l.id);

  const n = layers.length;
  const counts: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let max = 0;
  for (const e of graph.edges) {
    if (!DEP_EDGE_TYPES.has(e.type)) continue;
    const sl = nodeToLayer.get(e.source);
    const tl = nodeToLayer.get(e.target);
    if (!sl || !tl) continue;
    const r = idx.get(sl)!;
    const c = idx.get(tl)!;
    counts[r][c]++;
    if (counts[r][c] > max) max = counts[r][c];
  }
  return {
    layerIds: layers.map((l) => l.id),
    layerNames: layers.map((l) => l.name),
    counts,
    max,
  };
}

/** Edge ids (source|target|type) for a given (rowLayer→colLayer) cell. */
export function matrixCellEdges(
  graph: KnowledgeGraph,
  rowLayerId: string,
  colLayerId: string,
): GraphEdge[] {
  const nodeToLayer = new Map<string, string>();
  for (const l of graph.layers ?? []) for (const id of l.nodeIds) nodeToLayer.set(id, l.id);
  const out: GraphEdge[] = [];
  for (const e of graph.edges) {
    if (!DEP_EDGE_TYPES.has(e.type)) continue;
    if (nodeToLayer.get(e.source) === rowLayerId && nodeToLayer.get(e.target) === colLayerId) {
      out.push(e);
    }
  }
  return out;
}

// ── Reading-order BFS (200-156) ─────────────────────────────────────────────

const WALK_EDGE_TYPES = new Set<string>(["imports", "calls"]);
const ENTRY_TYPES = new Set<string>(["endpoint", "route", "command", "schedule", "api", "event"]);

/**
 * "Read the repo like a book": BFS over imports/calls starting from entrypoint
 * nodes (or, lacking those, the highest fan-in file nodes). Returns an ordered
 * list of file-like node ids — one per file, deduped, in discovery order.
 */
export function buildReadingOrder(graph: KnowledgeGraph): string[] {
  const fileLike = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type === "file" || n.type === "module") fileLike.add(n.id);
  }
  if (fileLike.size === 0) return [];

  // adjacency over walk edges (forward).
  const adj = new Map<string, string[]>();
  const fanIn = new Map<string, number>();
  for (const e of graph.edges) {
    if (!WALK_EDGE_TYPES.has(e.type)) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
    fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
  }

  // Roots: entrypoint nodes' code targets, else highest fan-in file nodes.
  const roots: string[] = [];
  const seenRoot = new Set<string>();
  // entrypoint → reachable file via used_by/reachable_from/handles_route etc.
  const entryNodeIds = new Set(graph.nodes.filter((n) => ENTRY_TYPES.has(n.type)).map((n) => n.id));
  if (entryNodeIds.size > 0) {
    for (const e of graph.edges) {
      let codeId: string | null = null;
      if (entryNodeIds.has(e.source) && fileLike.has(e.target)) codeId = e.target;
      else if (entryNodeIds.has(e.target) && fileLike.has(e.source)) codeId = e.source;
      if (codeId && !seenRoot.has(codeId)) { seenRoot.add(codeId); roots.push(codeId); }
    }
  }
  if (roots.length === 0) {
    // highest fan-in file nodes
    const ranked = [...fileLike].sort((a, b) => (fanIn.get(b) ?? 0) - (fanIn.get(a) ?? 0));
    for (const id of ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.1)))) {
      roots.push(id);
    }
  }
  if (roots.length === 0) roots.push(...fileLike);

  // BFS.
  const order: string[] = [];
  const visited = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (fileLike.has(id)) order.push(id);
    const nexts = (adj.get(id) ?? []).slice().sort((a, b) => (fanIn.get(a) ?? 0) - (fanIn.get(b) ?? 0));
    for (const nx of nexts) if (!visited.has(nx)) queue.push(nx);
  }
  // Append any unreached file nodes (islands) in stable order.
  for (const id of fileLike) if (!visited.has(id)) order.push(id);
  return order;
}

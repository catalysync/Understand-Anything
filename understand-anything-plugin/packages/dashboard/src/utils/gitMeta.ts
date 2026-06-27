// ── Git-metadata-driven selectors & helpers (300-series items 27/48/51/108/117/118) ──
//
// File nodes carry git metadata in `node.attrs`:
//   { churn, lastAuthor, lastCommitAt, lastCommit, owner, busFactor, topAuthors:[{a,c}] }
// enriched in parallel by the analyzer. Everything here is defensive: the
// metadata may be entirely absent (sparse graph → empty results / graceful
// no-ops) so the UIs render clean empty-states.
import type { GraphNode, GraphEdge, KnowledgeGraph } from "@understand-anything/core/types";
import { COMPLEXITY_RANK } from "../store";
import type { Complexity } from "../store";

// ---------------------------------------------------------------------------
// Typed view over the loosely-typed `attrs` bag.
// ---------------------------------------------------------------------------

export interface TopAuthor {
  /** author name */
  a: string;
  /** commit count */
  c: number;
}

export interface GitMeta {
  churn: number;
  lastAuthor: string | null;
  lastCommitAt: number | null;
  lastCommit: string | null;
  owner: string | null;
  busFactor: number | null;
  topAuthors: TopAuthor[];
}

/** Read the git metadata bag off a node (returns null when nothing is present). */
export function gitMetaFor(node: GraphNode | null | undefined): GitMeta | null {
  if (!node || !node.attrs) return null;
  const a = node.attrs;
  const churn = typeof a.churn === "number" ? a.churn : null;
  const lastAuthor = typeof a.lastAuthor === "string" ? a.lastAuthor : null;
  const lastCommitAt = typeof a.lastCommitAt === "number" ? a.lastCommitAt : null;
  const lastCommit = typeof a.lastCommit === "string" ? a.lastCommit : null;
  const owner = typeof a.owner === "string" ? a.owner : null;
  const busFactor = typeof a.busFactor === "number" ? a.busFactor : null;
  const topAuthorsRaw = Array.isArray(a.topAuthors) ? a.topAuthors : [];
  const topAuthors: TopAuthor[] = topAuthorsRaw
    .map((t): TopAuthor | null => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const name = typeof o.a === "string" ? o.a : null;
      const count = typeof o.c === "number" ? o.c : 0;
      if (!name) return null;
      return { a: name, c: count };
    })
    .filter((t): t is TopAuthor => t !== null);

  // Has ANY git signal? Otherwise return null so callers can short-circuit.
  if (
    churn === null && lastAuthor === null && lastCommitAt === null &&
    lastCommit === null && owner === null && busFactor === null && topAuthors.length === 0
  ) {
    return null;
  }
  return { churn: churn ?? 0, lastAuthor, lastCommitAt, lastCommit, owner, busFactor, topAuthors };
}

/** True if the graph has ANY git-metadata enrichment (gate for UIs). */
export function hasGitMeta(graph: KnowledgeGraph | null): boolean {
  if (!graph) return false;
  for (const n of graph.nodes) if (gitMetaFor(n) !== null) return true;
  return false;
}

/** All nodes that carry git metadata, paired with the parsed meta. */
export function gitNodes(graph: KnowledgeGraph | null): { node: GraphNode; meta: GitMeta }[] {
  if (!graph) return [];
  const out: { node: GraphNode; meta: GitMeta }[] = [];
  for (const n of graph.nodes) {
    const meta = gitMetaFor(n);
    if (meta) out.push({ node: n, meta });
  }
  return out;
}

/** Max churn across the graph (drives the churn bar scale). 0 if none. */
export function maxChurn(graph: KnowledgeGraph | null): number {
  let max = 0;
  for (const { meta } of gitNodes(graph)) if (meta.churn > max) max = meta.churn;
  return max;
}

/** Format an epoch-seconds timestamp as a short relative + absolute date. */
export function formatCommitDate(epochSec: number | null): { rel: string; abs: string } | null {
  if (epochSec === null || !Number.isFinite(epochSec)) return null;
  const ms = epochSec * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const abs = d.toISOString().slice(0, 10);
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  const day = 86_400_000;
  let rel: string;
  if (diff < day) rel = "today";
  else if (diff < 2 * day) rel = "yesterday";
  else if (diff < 30 * day) rel = `${Math.round(diff / day)}d ago`;
  else if (diff < 365 * day) rel = `${Math.round(diff / (30 * day))}mo ago`;
  else rel = `${Math.round(diff / (365 * day))}y ago`;
  return { rel, abs };
}

// ---------------------------------------------------------------------------
// Item 51: ownership / bus-factor overlay. Stable owner → hue mapping, plus a
// single-owner (busFactor === 1) flag for complex nodes.
// ---------------------------------------------------------------------------

/** Deterministic 32-bit hash of a string (FNV-1a). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable HSL color for an owner name (golden-angle hue, fixed S/L for legibility). */
export function ownerColor(owner: string): string {
  const hue = hashString(owner) % 360;
  return `hsl(${hue} 58% 60%)`;
}

export type OwnershipMode = "owner" | "single-owner";

export interface OwnershipOverlay {
  /** node id → fill color (owner-hue mode) or flag color (single-owner mode). */
  colorById: Map<string, string>;
  /** node ids flagged as single-owner complex hotspots (single-owner mode). */
  flaggedIds: Set<string>;
  /** distinct owners present (sorted by node count desc), for the legend. */
  owners: { owner: string; color: string; count: number }[];
}

const SINGLE_OWNER_FLAG_COLOR = "#d4a574";

/** Build the ownership overlay for the current mode. */
export function buildOwnershipOverlay(
  graph: KnowledgeGraph | null,
  mode: OwnershipMode,
): OwnershipOverlay {
  const colorById = new Map<string, string>();
  const flaggedIds = new Set<string>();
  const counts = new Map<string, number>();
  if (!graph) return { colorById, flaggedIds, owners: [] };

  for (const n of graph.nodes) {
    const meta = gitMetaFor(n);
    if (!meta) continue;
    const owner = meta.owner;
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);

    if (mode === "owner") {
      if (owner) colorById.set(n.id, ownerColor(owner));
    } else {
      // single-owner mode: flag busFactor===1 AND complex (refactor/off-board risk).
      const rank = COMPLEXITY_RANK[n.complexity as Complexity] ?? 0;
      if (meta.busFactor === 1 && rank >= 1) {
        flaggedIds.add(n.id);
        colorById.set(n.id, SINGLE_OWNER_FLAG_COLOR);
      }
    }
  }

  const owners = [...counts.entries()]
    .map(([owner, count]) => ({ owner, color: ownerColor(owner), count }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));

  return { colorById, flaggedIds, owners };
}

/** Node ids owned by a specific owner (for "show this owner's code" filter). */
export function nodeIdsForOwner(graph: KnowledgeGraph | null, owner: string): Set<string> {
  const out = new Set<string>();
  if (!graph) return out;
  for (const n of graph.nodes) {
    const meta = gitMetaFor(n);
    if (meta?.owner === owner) out.add(n.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Item 117: "suspect commit" — nodes with BOTH high churn AND that `raises` an
// error (churn-risk: code that changes a lot and is a known failure source).
// ---------------------------------------------------------------------------

/** A node id raises an error if it is the source of a `raises` edge to error_type. */
function buildRaisesSet(graph: KnowledgeGraph): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const out = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== "raises") continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s && t?.type === "error_type") out.add(s.id);
    else if (t && s?.type === "error_type") out.add(t.id);
  }
  return out;
}

/**
 * Churn-risk: a node that raises an error AND sits in the top churn band. The
 * threshold is the 75th-percentile churn (min 3) so it adapts to the repo.
 */
export function churnRiskIds(graph: KnowledgeGraph | null): Set<string> {
  const out = new Set<string>();
  if (!graph) return out;
  const gn = gitNodes(graph);
  if (gn.length === 0) return out;
  const churns = gn.map((g) => g.meta.churn).sort((a, b) => a - b);
  const p75 = churns[Math.floor(churns.length * 0.75)] ?? 0;
  const threshold = Math.max(3, p75);
  const raises = buildRaisesSet(graph);
  for (const { node, meta } of gn) {
    if (meta.churn >= threshold && raises.has(node.id)) out.add(node.id);
  }
  return out;
}

/** True if a single node is a churn-risk (high churn + raises an error). */
export function isChurnRisk(graph: KnowledgeGraph | null, id: string): boolean {
  return churnRiskIds(graph).has(id);
}

// ---------------------------------------------------------------------------
// Item 48: churn × complexity hotspot quadrant. A point per git-enriched file
// node: X = churn, Y = complexity rank, bubble size = LOC (lineRange) or a
// fallback. Upper-right quadrant = refactor priority.
// ---------------------------------------------------------------------------

export interface HotspotPoint {
  id: string;
  name: string;
  churn: number;
  /** complexity rank 0..2 mapped to a 0..1 Y. */
  complexityRank: number;
  complexity: string;
  /** lines-of-code estimate (from lineRange) or null. */
  loc: number | null;
  owner: string | null;
  busFactor: number | null;
  /** true when in the upper-right refactor-priority quadrant. */
  priority: boolean;
}

export interface HotspotData {
  points: HotspotPoint[];
  maxChurn: number;
  /** churn threshold (median) splitting the quadrant horizontally. */
  churnSplit: number;
  /** complexity-rank threshold splitting vertically (moderate+). */
  complexitySplit: number;
}

/** Build the hotspot scatter dataset from git-enriched file/code nodes. */
export function buildHotspotData(graph: KnowledgeGraph | null): HotspotData {
  const empty: HotspotData = { points: [], maxChurn: 0, churnSplit: 0, complexitySplit: 1 };
  if (!graph) return empty;
  const gn = gitNodes(graph);
  if (gn.length === 0) return empty;

  const churnsSorted = gn.map((g) => g.meta.churn).sort((a, b) => a - b);
  const churnSplit = churnsSorted[Math.floor(churnsSorted.length / 2)] ?? 0;
  const complexitySplit = 1; // moderate+ is the upper band
  let max = 0;

  const points: HotspotPoint[] = gn.map(({ node, meta }) => {
    const rank = COMPLEXITY_RANK[node.complexity as Complexity] ?? 0;
    const loc =
      node.lineRange && Array.isArray(node.lineRange)
        ? Math.max(1, node.lineRange[1] - node.lineRange[0] + 1)
        : null;
    if (meta.churn > max) max = meta.churn;
    const priority = meta.churn > churnSplit && rank >= complexitySplit;
    return {
      id: node.id,
      name: node.name,
      churn: meta.churn,
      complexityRank: rank,
      complexity: node.complexity,
      loc,
      owner: meta.owner,
      busFactor: meta.busFactor,
      priority,
    };
  });

  // Sort priority points first so they paint on top.
  points.sort((a, b) => Number(a.priority) - Number(b.priority));
  return { points, maxChurn: max, churnSplit, complexitySplit };
}

// ---------------------------------------------------------------------------
// Item 27: circular-dependency detector over `imports` edges (Tarjan SCC +
// path extraction). Returns the cycles and the involved node/edge sets.
// ---------------------------------------------------------------------------

export interface DependencyCycles {
  /** ordered node-id paths for each detected cycle (each path is a loop). */
  cycles: string[][];
  /** every node id that participates in at least one cycle. */
  nodeIds: Set<string>;
  /** "src->tgt" keys for every import edge inside a cycle. */
  edgeKeys: Set<string>;
}

const CYCLE_EDGE_TYPE = "imports";

/** Detect import cycles (strongly-connected components of size > 1, or self-loops). */
export function detectImportCycles(graph: KnowledgeGraph | null): DependencyCycles {
  const empty: DependencyCycles = { cycles: [], nodeIds: new Set(), edgeKeys: new Set() };
  if (!graph) return empty;

  // Build adjacency over import edges only.
  const adj = new Map<string, string[]>();
  const nodeSet = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== CYCLE_EDGE_TYPE) continue;
    nodeSet.add(e.source);
    nodeSet.add(e.target);
    let l = adj.get(e.source);
    if (!l) { l = []; adj.set(e.source, l); }
    l.push(e.target);
  }
  if (nodeSet.size === 0) return empty;

  // Tarjan's SCC (iterative to avoid stack overflow on large graphs).
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  for (const start of nodeSet) {
    if (idx.has(start)) continue;
    // iterative DFS frame: [node, childPointer]
    const work: { v: string; i: number }[] = [{ v: start, i: 0 }];
    idx.set(start, index); low.set(start, index); index++;
    stack.push(start); onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame.v;
      const neighbors = adj.get(v) ?? [];
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i];
        frame.i++;
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index++;
          stack.push(w); onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      } else {
        // done with v: propagate low-link to parent, possibly close an SCC.
        if (low.get(v) === idx.get(v)) {
          const comp: string[] = [];
          while (true) {
            const w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === v) break;
          }
          if (comp.length > 1) sccs.push(comp);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(v)!));
      }
    }
  }

  // Self-loops (a file importing itself) count as a cycle too.
  for (const [src, tgts] of adj) {
    if (tgts.includes(src)) sccs.push([src]);
  }

  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const cycles: string[][] = [];

  for (const comp of sccs) {
    const compSet = new Set(comp);
    for (const id of comp) nodeIds.add(id);
    // Mark intra-SCC import edges.
    for (const id of comp) {
      for (const t of adj.get(id) ?? []) {
        if (compSet.has(t)) edgeKeys.add(`${id}->${t}`);
      }
    }
    // Extract a representative cycle path through the component for display.
    const path = extractCyclePath(comp, adj);
    if (path.length > 0) cycles.push(path);
  }

  // Sort cycles longest-first (most interesting), cap display count upstream.
  cycles.sort((a, b) => b.length - a.length);
  return { cycles, nodeIds, edgeKeys };
}

/** Find one closed cycle path within an SCC via DFS back-edge detection. */
function extractCyclePath(comp: string[], adj: Map<string, string[]>): string[] {
  const compSet = new Set(comp);
  // self-loop
  if (comp.length === 1) {
    const v = comp[0];
    if ((adj.get(v) ?? []).includes(v)) return [v, v];
    return [];
  }
  const start = comp[0];
  const stack: string[] = [];
  const inPath = new Set<string>();
  const seen = new Set<string>();
  let found: string[] = [];

  const dfs = (v: string): boolean => {
    stack.push(v); inPath.add(v); seen.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!compSet.has(w)) continue;
      if (inPath.has(w)) {
        // back edge → close the loop from w to v.
        const i = stack.indexOf(w);
        found = [...stack.slice(i), w];
        return true;
      }
      if (!seen.has(w) && dfs(w)) return true;
    }
    stack.pop(); inPath.delete(v);
    return false;
  };
  dfs(start);
  return found;
}

/** True if the graph has any import edges (gate for the cycle UI). */
export function hasImportEdges(graph: KnowledgeGraph | null): boolean {
  if (!graph) return false;
  for (const e of graph.edges) if (e.type === CYCLE_EDGE_TYPE) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Item 108: resilience badges on `calls` edges. Detect retry / breaker /
// timeout signals from the callee node's tags / summary / a `resilience` attr.
// Graceful no-op when nothing is annotated (sparse).
// ---------------------------------------------------------------------------

export type ResilienceKind = "retry" | "breaker" | "timeout" | "fallback" | "bulkhead";

export const RESILIENCE_GLYPH: Record<ResilienceKind, string> = {
  retry: "↻",
  breaker: "⊘",
  timeout: "⏱",
  fallback: "⇄",
  bulkhead: "▥",
};

export const RESILIENCE_LABEL: Record<ResilienceKind, string> = {
  retry: "Retry",
  breaker: "Circuit breaker",
  timeout: "Timeout",
  fallback: "Fallback",
  bulkhead: "Bulkhead",
};

const RESILIENCE_PATTERNS: { kind: ResilienceKind; re: RegExp }[] = [
  { kind: "breaker", re: /\b(circuit[\s-]?breaker|breaker|circuitbreaker)\b/i },
  { kind: "retry", re: /\b(retry|retries|retrying|backoff|exponential[\s-]?backoff)\b/i },
  { kind: "timeout", re: /\b(timeout|deadline|time[\s-]?limit)\b/i },
  { kind: "fallback", re: /\b(fallback|degrade|graceful[\s-]?degrad)\b/i },
  { kind: "bulkhead", re: /\b(bulkhead|isolation pool|concurrency limit)\b/i },
];

/** Detect resilience kinds annotated on a node (tags, attrs.resilience, summary). */
export function resilienceKindsFor(node: GraphNode | undefined): ResilienceKind[] {
  if (!node) return [];
  const found = new Set<ResilienceKind>();

  // 1. explicit attrs.resilience (array of kind strings or objects with .kind).
  const r = node.attrs?.resilience;
  if (Array.isArray(r)) {
    for (const item of r) {
      const k = typeof item === "string" ? item : (item && typeof item === "object" ? (item as Record<string, unknown>).kind : null);
      if (typeof k === "string") {
        const match = RESILIENCE_PATTERNS.find((p) => p.re.test(k));
        if (match) found.add(match.kind);
      }
    }
  }

  // 2. tags.
  for (const tag of node.tags ?? []) {
    for (const p of RESILIENCE_PATTERNS) if (p.re.test(tag)) found.add(p.kind);
  }

  // 3. summary text (last resort, lower-confidence but useful).
  const summary = node.summary ?? "";
  if (summary) {
    for (const p of RESILIENCE_PATTERNS) if (p.re.test(summary)) found.add(p.kind);
  }

  return [...found];
}

/**
 * Map every `calls` edge whose callee (target) has resilience annotations to its
 * kinds. Key is "src->tgt". Returns an empty map when nothing is annotated.
 */
export function resilienceEdgeMap(graph: KnowledgeGraph | null): Map<string, ResilienceKind[]> {
  const out = new Map<string, ResilienceKind[]>();
  if (!graph) return out;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  for (const e of graph.edges) {
    if (e.type !== "calls") continue;
    const callee = byId.get(e.target);
    const kinds = resilienceKindsFor(callee);
    if (kinds.length > 0) out.set(`${e.source}->${e.target}`, kinds);
  }
  return out;
}

/** True if the graph has ANY resilience annotation (gate for the UI). */
export function hasResilienceData(graph: KnowledgeGraph | null): boolean {
  if (!graph) return false;
  for (const n of graph.nodes) if (resilienceKindsFor(n).length > 0) return true;
  return false;
}

// Re-export so callers can reference an edge key consistently.
export function edgeKey(e: GraphEdge): string {
  return `${e.source}->${e.target}`;
}

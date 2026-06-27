// ── Operations-layer (300-series) selectors & helpers ──────────────────────
//
// Pure functions over the KnowledgeGraph — no React, no store. They power the
// keystone cross-layer navigation (`used_by`), the Front Door entrypoint index,
// the API/route map, and the reachability / dead-code overlay.
//
// Everything here is defensive: the operations-layer graph is enriched in
// parallel and may be entirely absent. Each selector returns empty results
// gracefully so the UIs render clean empty-states.
import type { GraphNode, GraphEdge, KnowledgeGraph, NodeType } from "@understand-anything/core/types";

// ---------------------------------------------------------------------------
// Node-type sets (mirror the operations-layer NodeType union from the schema).
// ---------------------------------------------------------------------------

/** Entrypoint node types — the "Front Door" of the system. */
export const ENTRYPOINT_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "endpoint", "route", "command", "event", "schedule",
]);

/** "Code" node types that can define/back an operations-layer node. */
export const CODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "file", "function", "class", "module",
]);

/** Operations-layer node types (everything 300-series, non-code, non-domain). */
export const OPS_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "route", "command", "event", "schedule", "api",
  "test", "suite", "fixture", "finding",
  "endpoint", "table", "column", "model", "query", "transaction", "migration",
  "env_var", "feature_flag", "secret", "cache_key", "payload_schema",
  "error_type",
  "log_site", "span_site", "metric", "alert",
  "owner", "doc",
]);

/** Edge types that connect a code node to an operations-layer node. */
const OPS_EDGE_TYPES: ReadonlySet<string> = new Set<string>([
  // entrypoints / API surface
  "handles_route", "exposes_api", "provides_api", "consumes_api",
  "emits_event", "consumes_event", "triggered_by", "subcommand_of",
  "publishes_to", "subscribes_to",
  // tests
  "covers", "asserts_on", "uses_fixture", "tested_by",
  // data
  "queries_table", "reads_table", "writes_table", "used_by",
  "maps_to_table", "has_column", "has_association", "opens_transaction",
  // errors
  "raises", "handles", "wraps", "swallows", "recovers",
  // observability
  "logs", "instruments", "enriches_span", "emits_metric", "alerts_on",
  // ownership / config
  "owns", "owned_by", "part_of",
  "reads_config", "gated_by_flag", "secret_in_file", "caches", "reads_cache", "invalidates",
]);

/** Edges to walk for reachability (entrypoint → handler → callees → data). */
export const REACH_EDGE_TYPES: ReadonlySet<string> = new Set<string>([
  "calls", "handles_route", "queries_table", "reads_table", "writes_table",
  "contains", "exposes_api", "provides_api", "consumes_api",
  "emits_event", "triggered_by", "used_by",
]);

// ---------------------------------------------------------------------------
// Icons + human labels for node types (used in NodeInfo, Front Door, legend).
// ---------------------------------------------------------------------------

const NODE_TYPE_ICONS: Partial<Record<NodeType, string>> = {
  endpoint: "🌐", route: "🌐", api: "🌐",
  command: "⌨", event: "⚡", schedule: "⏱",
  test: "✓", suite: "✓", fixture: "🧩", finding: "⚠",
  table: "▤", column: "▤", model: "▤", query: "▤",
  transaction: "▤", migration: "▤", cache_key: "▤", payload_schema: "▤",
  env_var: "⚙", feature_flag: "⚑", secret: "🔒",
  error_type: "✕",
  log_site: "≡", span_site: "≡", metric: "📈", alert: "🔔",
  owner: "👤", doc: "📄",
};

/** A short glyph for a node type (falls back to a neutral dot). */
export function nodeTypeIcon(type: NodeType | string): string {
  return NODE_TYPE_ICONS[type as NodeType] ?? "•";
}

/** Humanized label for a node type ("error_type" → "Error type"). */
export function nodeTypeLabel(type: NodeType | string): string {
  return String(type).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `method · path` identity for a route/endpoint node (best-effort). */
export function routeIdentity(node: GraphNode): { method: string | null; path: string | null } {
  const method = node.httpMethod ?? (typeof node.attrs?.method === "string" ? (node.attrs.method as string) : null);
  const path = node.path ?? (typeof node.attrs?.path === "string" ? (node.attrs.path as string) : null) ?? null;
  return { method: method ? method.toUpperCase() : null, path };
}

// ---------------------------------------------------------------------------
// The keystone selector: ops-layer nodes connected to a code node (and the
// reverse — code nodes that define/use an ops-layer node), grouped by relation.
// ---------------------------------------------------------------------------

export interface OpsRow {
  node: GraphNode;
  edge: GraphEdge;
  /** True when `id` is the edge source (outgoing). */
  outgoing: boolean;
}

export interface OpsGroup {
  /** Human heading, e.g. "Exposes", "Queries", "Raises", "Tested by". */
  label: string;
  /** Underlying edge type (for keys / debugging). */
  edgeType: string;
  rows: OpsRow[];
}

/**
 * Map an (edgeType, direction) pair to the verb heading shown in the inspector.
 * Reads naturally from the *selected* node's perspective.
 */
function relationLabel(edgeType: string, outgoing: boolean): string {
  const M: Record<string, [string, string]> = {
    // edgeType: [outgoing(source) label, incoming(target) label]
    handles_route: ["Handles route", "Exposes"],
    exposes_api: ["Exposes API", "Exposed by"],
    provides_api: ["Provides API", "Provided by"],
    consumes_api: ["Consumes API", "Consumed by"],
    emits_event: ["Emits event", "Emitted by"],
    consumes_event: ["Consumes event", "Consumed by"],
    triggered_by: ["Triggered by", "Triggers"],
    subcommand_of: ["Subcommand of", "Has subcommand"],
    publishes_to: ["Publishes to", "Published by"],
    subscribes_to: ["Subscribes to", "Subscribed by"],
    tested_by: ["Tested by", "Tests"],
    covers: ["Covers", "Tested by"],
    asserts_on: ["Asserts on", "Asserted by"],
    uses_fixture: ["Uses fixture", "Fixture for"],
    queries_table: ["Queries", "Queried by"],
    reads_table: ["Reads", "Read by"],
    writes_table: ["Writes", "Written by"],
    used_by: ["Uses", "Used by"],
    maps_to_table: ["Maps to table", "Mapped by"],
    has_column: ["Has column", "Column of"],
    has_association: ["Associated with", "Associated from"],
    opens_transaction: ["Opens transaction", "Opened by"],
    raises: ["Raises", "Raised by"],
    handles: ["Handles error", "Handled by"],
    wraps: ["Wraps error", "Wrapped by"],
    swallows: ["Swallows", "Swallowed by"],
    recovers: ["Recovers", "Recovered by"],
    logs: ["Logs", "Logged by"],
    instruments: ["Instruments", "Instrumented by"],
    enriches_span: ["Enriches span", "Enriched by"],
    emits_metric: ["Emits metric", "Emitted by"],
    alerts_on: ["Alerts on", "Alerted by"],
    owns: ["Owns", "Owned by"],
    owned_by: ["Owned by", "Owns"],
    part_of: ["Part of", "Contains"],
    reads_config: ["Reads config", "Config for"],
    gated_by_flag: ["Gated by flag", "Gates"],
    secret_in_file: ["Reads secret", "Secret for"],
    caches: ["Caches", "Cached by"],
    reads_cache: ["Reads cache", "Cache read by"],
    invalidates: ["Invalidates", "Invalidated by"],
  };
  const pair = M[edgeType];
  if (pair) return outgoing ? pair[0] : pair[1];
  const formatted = nodeTypeLabel(edgeType);
  return outgoing ? formatted : `${formatted} (reverse)`;
}

/**
 * THE KEYSTONE. Given any node id, return the cross-layer operations connections
 * grouped by relation. When the node is a code node, this surfaces the ops-layer
 * nodes it backs (routes it handles, tables it queries, errors it raises, tests
 * that cover it, config it reads, …). When the node is an ops-layer node, this
 * surfaces the code nodes that define/use it.
 *
 * Only edges in OPS_EDGE_TYPES are considered, so structural/call edges are not
 * duplicated here (NodeInfo's existing "connections" section covers those).
 * Returns [] when the graph has no operations-layer enrichment yet.
 */
export function opsLayerForNode(graph: KnowledgeGraph | null, id: string): OpsGroup[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const groups = new Map<string, OpsGroup>();

  for (const edge of graph.edges) {
    if (!OPS_EDGE_TYPES.has(edge.type)) continue;
    const isSource = edge.source === id;
    const isTarget = edge.target === id;
    if (!isSource && !isTarget) continue;
    const otherId = isSource ? edge.target : edge.source;
    const other = byId.get(otherId);
    if (!other) continue;
    const label = relationLabel(edge.type, isSource);
    const key = `${label}::${edge.type}`;
    let g = groups.get(key);
    if (!g) {
      g = { label, edgeType: edge.type, rows: [] };
      groups.set(key, g);
    }
    // Dedup by other-node id within a group.
    if (g.rows.some((r) => r.node.id === otherId)) continue;
    g.rows.push({ node: other, edge, outgoing: isSource });
  }

  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** True if a node has ANY operations-layer connection. Cheap gate for UI. */
export function hasOpsLayer(graph: KnowledgeGraph | null, id: string): boolean {
  if (!graph) return false;
  for (const edge of graph.edges) {
    if (!OPS_EDGE_TYPES.has(edge.type)) continue;
    if (edge.source === id || edge.target === id) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Front Door index: every entrypoint node grouped by kind.
// ---------------------------------------------------------------------------

export interface EntrypointEntry {
  node: GraphNode;
  /** Handler code node (via handles_route / used_by / exposes_api), if resolved. */
  handler: GraphNode | null;
  method: string | null;
  path: string | null;
}

export interface EntrypointGroup {
  type: NodeType;
  label: string;
  entries: EntrypointEntry[];
}

/** Resolve the code node that handles an entrypoint node. */
export function handlerForEntrypoint(graph: KnowledgeGraph, entrypointId: string): GraphNode | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  // Prefer explicit handler edges; the entrypoint is usually the edge SOURCE
  // (handles_route: source=route → target=handler) but accept either end.
  const HANDLER_EDGES = ["handles_route", "exposes_api", "provides_api", "triggered_by", "used_by"];
  for (const pref of HANDLER_EDGES) {
    for (const e of graph.edges) {
      if (e.type !== pref) continue;
      if (e.source === entrypointId) {
        const t = byId.get(e.target);
        if (t && CODE_TYPES.has(t.type)) return t;
      }
      if (e.target === entrypointId) {
        const s = byId.get(e.source);
        if (s && CODE_TYPES.has(s.type)) return s;
      }
    }
  }
  return null;
}

/** Build the Front Door index: all entrypoint nodes grouped by type. */
export function entrypointIndex(graph: KnowledgeGraph | null): EntrypointGroup[] {
  if (!graph) return [];
  const order: NodeType[] = ["route", "endpoint", "command", "event", "schedule"];
  const buckets = new Map<NodeType, EntrypointEntry[]>();
  for (const node of graph.nodes) {
    if (!ENTRYPOINT_TYPES.has(node.type)) continue;
    const { method, path } = routeIdentity(node);
    const entry: EntrypointEntry = {
      node,
      handler: handlerForEntrypoint(graph, node.id),
      method,
      path,
    };
    let list = buckets.get(node.type);
    if (!list) {
      list = [];
      buckets.set(node.type, list);
    }
    list.push(entry);
  }
  const groups: EntrypointGroup[] = [];
  for (const type of order) {
    const entries = buckets.get(type);
    if (!entries || entries.length === 0) continue;
    entries.sort((a, b) => {
      const ap = `${a.method ?? ""} ${a.path ?? a.node.name}`;
      const bp = `${b.method ?? ""} ${b.path ?? b.node.name}`;
      return ap.localeCompare(bp);
    });
    groups.push({ type, label: nodeTypeLabel(type), entries });
  }
  return groups;
}

/** Flat list of all route/endpoint entries for the API/Route map table. */
export function routeMap(graph: KnowledgeGraph | null): EntrypointEntry[] {
  if (!graph) return [];
  const rows: EntrypointEntry[] = [];
  for (const node of graph.nodes) {
    if (node.type !== "route" && node.type !== "endpoint") continue;
    const { method, path } = routeIdentity(node);
    rows.push({ node, handler: handlerForEntrypoint(graph, node.id), method, path });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reachability / dead-code overlay (BFS over outgoing reach edges).
// ---------------------------------------------------------------------------

/**
 * BFS the set of nodes reachable from `rootIds` following outgoing edges in
 * REACH_EDGE_TYPES. The roots themselves are included. Cycle-safe.
 */
export function reachableFrom(graph: KnowledgeGraph, rootIds: Iterable<string>): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!REACH_EDGE_TYPES.has(e.type)) continue;
    let list = adj.get(e.source);
    if (!list) {
      list = [];
      adj.set(e.source, list);
    }
    list.push(e.target);
  }
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const r of rootIds) {
    if (!seen.has(r)) {
      seen.add(r);
      queue.push(r);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      queue.push(nxt);
    }
  }
  return seen;
}

/** All entrypoint node ids (Front Door roots) in the graph. */
export function allEntrypointIds(graph: KnowledgeGraph): string[] {
  return graph.nodes.filter((n) => ENTRYPOINT_TYPES.has(n.type)).map((n) => n.id);
}

/**
 * Dead-code set: nodes reachable from NO entrypoint. Computed as the complement
 * of reachableFrom(all entrypoints). Returns an empty set if there are no
 * entrypoints (we can't conclude anything is dead without a root).
 */
export function deadCodeSet(graph: KnowledgeGraph): Set<string> {
  const roots = allEntrypointIds(graph);
  if (roots.length === 0) return new Set();
  const live = reachableFrom(graph, roots);
  const dead = new Set<string>();
  for (const n of graph.nodes) {
    if (!live.has(n.id)) dead.add(n.id);
  }
  return dead;
}

// ---------------------------------------------------------------------------
// Tests & coverage (items 39-41, 45). A `test` node "covers" a code node via a
// `covers` (test→code) or `tested_by` (code→test) edge. We treat both directions
// as the same relation so the analyzer can emit whichever is convenient.
// ---------------------------------------------------------------------------

/** Node types we paint with the tri-state coverage overlay (the "code" surface). */
export const COVERAGE_TARGET_TYPES: ReadonlySet<NodeType> = CODE_TYPES;

/** Edges that mean "test ↔ code under test", in either direction. */
const COVERS_EDGE_TYPES: ReadonlySet<string> = new Set<string>(["covers", "tested_by"]);

export type CoverageState = "covered" | "partial" | "uncovered";

/**
 * For every code node, the set of `test` node ids that cover it. A code node is
 * "covered" when it has ≥1 covering test. Edges are matched in both directions:
 *   covers:    source=test    → target=code
 *   tested_by: source=code    → target=test
 * but we tolerate the reverse too (defensive — the analyzer is being enriched).
 */
export function coveringTestsByCode(graph: KnowledgeGraph | null): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!graph) return out;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const add = (codeId: string, testId: string) => {
    let s = out.get(codeId);
    if (!s) {
      s = new Set();
      out.set(codeId, s);
    }
    s.add(testId);
  };
  for (const e of graph.edges) {
    if (!COVERS_EDGE_TYPES.has(e.type)) continue;
    const sn = byId.get(e.source);
    const tn = byId.get(e.target);
    if (!sn || !tn) continue;
    // Identify which endpoint is the test and which is the code-under-test.
    if (sn.type === "test" && CODE_TYPES.has(tn.type)) add(tn.id, sn.id);
    else if (tn.type === "test" && CODE_TYPES.has(sn.type)) add(sn.id, tn.id);
    else if (sn.type === "test") add(tn.id, sn.id); // test→anything
    else if (tn.type === "test") add(sn.id, tn.id); // anything→test
  }
  return out;
}

/** The `test` nodes that cover a single code node (resolved GraphNodes). */
export function coveringTestsForNode(graph: KnowledgeGraph | null, codeId: string): GraphNode[] {
  if (!graph) return [];
  const map = coveringTestsByCode(graph);
  const ids = map.get(codeId);
  if (!ids || ids.size === 0) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  return [...ids].map((id) => byId.get(id)).filter((n): n is GraphNode => !!n);
}

/** The code nodes a single `test` node covers (resolved GraphNodes). */
export function codeUnderTest(graph: KnowledgeGraph | null, testId: string): GraphNode[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const seen = new Set<string>();
  const out: GraphNode[] = [];
  for (const e of graph.edges) {
    if (!COVERS_EDGE_TYPES.has(e.type)) continue;
    let otherId: string | null = null;
    if (e.source === testId) otherId = e.target;
    else if (e.target === testId) otherId = e.source;
    if (!otherId || seen.has(otherId)) continue;
    const other = byId.get(otherId);
    if (other && CODE_TYPES.has(other.type)) {
      seen.add(otherId);
      out.push(other);
    }
  }
  return out;
}

/**
 * Per-node coverage classification. Leaf code nodes are covered/uncovered (no
 * "partial" — a single fn is binary). Folder/layer/file aggregate nodes get a
 * partial state and a percentage from their descendants.
 *
 * `coverageStateForNode` returns the tri-state for a single node id; for an
 * aggregate (file/module with children) it derives from contained code nodes.
 */
export interface CoverageInfo {
  state: CoverageState;
  /** 0..1 fraction of descendant code nodes that are covered (aggregate nodes). */
  pct: number | null;
  /** number of covering tests for a leaf node. */
  testCount: number;
}

export function buildCoverageInfo(graph: KnowledgeGraph | null): Map<string, CoverageInfo> {
  const info = new Map<string, CoverageInfo>();
  if (!graph) return info;
  const covering = coveringTestsByCode(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));

  // children via `contains` (file→fn/class, module→file …).
  const childrenOf = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type !== "contains") continue;
    let list = childrenOf.get(e.source);
    if (!list) {
      list = [];
      childrenOf.set(e.source, list);
    }
    list.push(e.target);
  }

  // Memoized descendant-coverage aggregation (covered / total code leaves).
  const agg = new Map<string, { covered: number; total: number }>();
  const visiting = new Set<string>();
  function aggregate(id: string): { covered: number; total: number } {
    const cached = agg.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return { covered: 0, total: 0 };
    visiting.add(id);
    const node = byId.get(id);
    let covered = 0;
    let total = 0;
    const kids = childrenOf.get(id) ?? [];
    if (kids.length > 0) {
      for (const k of kids) {
        const sub = aggregate(k);
        covered += sub.covered;
        total += sub.total;
      }
    }
    // A code node itself counts as a leaf unit when it has no code children.
    if (node && CODE_TYPES.has(node.type) && kids.length === 0) {
      total += 1;
      if ((covering.get(id)?.size ?? 0) > 0) covered += 1;
    }
    const res = { covered, total };
    agg.set(id, res);
    visiting.delete(id);
    return res;
  }

  for (const n of graph.nodes) {
    const hasKids = (childrenOf.get(n.id)?.length ?? 0) > 0;
    const testCount = covering.get(n.id)?.size ?? 0;
    if (hasKids) {
      const { covered, total } = aggregate(n.id);
      if (total === 0) continue; // no code under it — skip, leave unpainted
      const pct = covered / total;
      const state: CoverageState =
        pct >= 0.999 ? "covered" : pct <= 0.001 ? "uncovered" : "partial";
      info.set(n.id, { state, pct, testCount });
    } else if (CODE_TYPES.has(n.type)) {
      info.set(n.id, {
        state: testCount > 0 ? "covered" : "uncovered",
        pct: testCount > 0 ? 1 : 0,
        testCount,
      });
    }
  }
  return info;
}

/** True if the graph has ANY test→code coverage edge (gate for the overlay UI). */
export function hasCoverageData(graph: KnowledgeGraph | null): boolean {
  if (!graph) return false;
  for (const e of graph.edges) if (COVERS_EDGE_TYPES.has(e.type)) return true;
  return false;
}

/**
 * Test-impact (item 45). Given a set of changed/selected code node ids, return
 * the `test` nodes whose covered closure includes any of them — i.e. the tests
 * to run. We follow reverse `calls`/`covers` so a test that covers a function
 * which (transitively) calls a changed function is included.
 */
export function impactedTests(
  graph: KnowledgeGraph | null,
  changedIds: Iterable<string>,
): GraphNode[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  // Reverse call adjacency: callee → callers. A change to a callee impacts callers.
  const callers = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type !== "calls") continue;
    let list = callers.get(e.target);
    if (!list) {
      list = [];
      callers.set(e.target, list);
    }
    list.push(e.source);
  }
  // BFS the reverse-call closure of the changed set.
  const closure = new Set<string>();
  const queue: string[] = [];
  for (const id of changedIds) {
    if (!closure.has(id)) {
      closure.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const c of callers.get(cur) ?? []) {
      if (!closure.has(c)) {
        closure.add(c);
        queue.push(c);
      }
    }
  }
  // Collect tests covering anything in the closure.
  const covering = coveringTestsByCode(graph);
  const testIds = new Set<string>();
  for (const codeId of closure) {
    for (const tid of covering.get(codeId) ?? []) testIds.add(tid);
  }
  return [...testIds].map((id) => byId.get(id)).filter((n): n is GraphNode => !!n);
}

// ---------------------------------------------------------------------------
// Data / ERD (items 61-64, 69). Tables + columns + foreign keys as a graph.
// ---------------------------------------------------------------------------

const FK_EDGE_TYPES: ReadonlySet<string> = new Set<string>(["foreign_key", "inferred_fk"]);

export interface ErdColumn {
  node: GraphNode;
  /** True when this column is a primary/foreign key (best-effort from attrs/tags). */
  isKey: boolean;
  isPk: boolean;
  isFk: boolean;
}

export interface ErdTable {
  node: GraphNode;
  columns: ErdColumn[];
}

export interface ErdFk {
  edge: GraphEdge;
  /** Resolved table ids for the FK (best-effort — column endpoints map up to tables). */
  fromTable: string | null;
  toTable: string | null;
  inferred: boolean;
}

function columnIsKey(n: GraphNode): { isKey: boolean; isPk: boolean; isFk: boolean } {
  const tags = n.tags ?? [];
  const a = n.attrs ?? {};
  const isPk = tags.includes("pk") || tags.includes("primary_key") || a.primaryKey === true || a.pk === true;
  const isFk = tags.includes("fk") || tags.includes("foreign_key") || a.foreignKey === true || a.fk === true ||
    /_id$/.test(n.name);
  return { isKey: isPk || isFk, isPk: !!isPk, isFk: !!isFk };
}

/**
 * Build the ERD model: every `table` node with its `column` children (via
 * `has_column`/`contains`), plus FK edges resolved to table endpoints. Returns
 * empty arrays when there are no `table` nodes yet (sparse graph → empty state).
 */
export function buildErd(graph: KnowledgeGraph | null): { tables: ErdTable[]; fks: ErdFk[] } {
  if (!graph) return { tables: [], fks: [] };
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const tables = graph.nodes.filter((n) => n.type === "table");
  if (tables.length === 0) return { tables: [], fks: [] };

  // column → owning table (via has_column or contains from a table; or column.attrs.table).
  const colToTable = new Map<string, string>();
  const colsByTable = new Map<string, GraphNode[]>();
  for (const e of graph.edges) {
    if (e.type !== "has_column" && e.type !== "contains") continue;
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (src?.type === "table" && tgt?.type === "column") {
      colToTable.set(tgt.id, src.id);
      let list = colsByTable.get(src.id);
      if (!list) {
        list = [];
        colsByTable.set(src.id, list);
      }
      list.push(tgt);
    }
  }

  const erdTables: ErdTable[] = tables.map((t) => {
    const cols = (colsByTable.get(t.id) ?? []).map((c) => {
      const k = columnIsKey(c);
      return { node: c, ...k } as ErdColumn;
    });
    return { node: t, columns: cols };
  });

  // Resolve FK edges to table endpoints. Endpoints may be columns or tables.
  const resolveTable = (id: string): string | null => {
    const n = byId.get(id);
    if (!n) return null;
    if (n.type === "table") return n.id;
    if (n.type === "column") return colToTable.get(n.id) ?? null;
    return null;
  };
  const fks: ErdFk[] = [];
  for (const e of graph.edges) {
    if (!FK_EDGE_TYPES.has(e.type)) continue;
    fks.push({
      edge: e,
      fromTable: resolveTable(e.source),
      toTable: resolveTable(e.target),
      inferred: e.type === "inferred_fk",
    });
  }
  return { tables: erdTables, fks };
}

/** Code nodes that read/write a given column or table (via used_by / queries_table). */
export function dataConsumers(graph: KnowledgeGraph | null, dataId: string): OpsRow[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const DATA_USE_EDGES = new Set<string>(["used_by", "queries_table", "reads_table", "writes_table"]);
  const out: OpsRow[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!DATA_USE_EDGES.has(e.type)) continue;
    const isSource = e.source === dataId;
    const isTarget = e.target === dataId;
    if (!isSource && !isTarget) continue;
    const otherId = isSource ? e.target : e.source;
    if (seen.has(otherId)) continue;
    const other = byId.get(otherId);
    if (!other || !CODE_TYPES.has(other.type)) continue;
    seen.add(otherId);
    out.push({ node: other, edge: e, outgoing: isSource });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Function data-footprint (items 71-73) + config/env map (item 86).
// ---------------------------------------------------------------------------

export interface DataFootprintRow {
  node: GraphNode;
  /** "read" | "write" | null (from the edge `access` field or edge type). */
  access: "read" | "write" | null;
  edgeType: string;
}

/** Tables/columns a code node queries, with read/write directionality. */
export function dataFootprint(graph: KnowledgeGraph | null, codeId: string): DataFootprintRow[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const Q = new Set<string>(["queries_table", "reads_table", "writes_table", "used_by"]);
  const rows: DataFootprintRow[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!Q.has(e.type)) continue;
    let otherId: string | null = null;
    if (e.source === codeId) otherId = e.target;
    else if (e.target === codeId) otherId = e.source;
    if (!otherId) continue;
    const other = byId.get(otherId);
    if (!other || (other.type !== "table" && other.type !== "column" && other.type !== "model" && other.type !== "query")) continue;
    const key = `${e.type}:${otherId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const access: "read" | "write" | null =
      e.access ?? (e.type === "reads_table" ? "read" : e.type === "writes_table" ? "write" : null);
    rows.push({ node: other, access, edgeType: e.type });
  }
  return rows;
}

/** Env vars a code node reads (via reads_config). */
export function envVarsForCode(graph: KnowledgeGraph | null, codeId: string): GraphNode[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const seen = new Set<string>();
  const out: GraphNode[] = [];
  for (const e of graph.edges) {
    if (e.type !== "reads_config") continue;
    let otherId: string | null = null;
    if (e.source === codeId) otherId = e.target;
    else if (e.target === codeId) otherId = e.source;
    if (!otherId || seen.has(otherId)) continue;
    const other = byId.get(otherId);
    if (other && (other.type === "env_var" || other.type === "feature_flag" || other.type === "secret")) {
      seen.add(otherId);
      out.push(other);
    }
  }
  return out;
}

export interface ConfigEntry {
  node: GraphNode;
  required: boolean;
  /** Code nodes that read this env var (reverse reads_config). */
  consumers: GraphNode[];
}

/** True when an env_var node is marked required (no default). */
function envVarRequired(n: GraphNode): boolean {
  const a = n.attrs ?? {};
  if (a.required === true) return true;
  if (a.required === false) return false;
  if ((n.tags ?? []).includes("required")) return true;
  if ((n.tags ?? []).includes("optional")) return false;
  // required-no-default heuristic: a default present → optional.
  if (a.default !== undefined && a.default !== null && a.default !== "") return false;
  return false;
}

/** Config/env map (item 86): every env_var node + required flag + consumers. */
export function configMap(graph: KnowledgeGraph | null): ConfigEntry[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const envVars = graph.nodes.filter(
    (n) => n.type === "env_var" || n.type === "feature_flag" || n.type === "secret",
  );
  if (envVars.length === 0) return [];
  const consumersByVar = new Map<string, GraphNode[]>();
  const seen = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.type !== "reads_config" && e.type !== "gated_by_flag" && e.type !== "secret_in_file") continue;
    // env_var is one endpoint; the code node is the other.
    const sn = byId.get(e.source);
    const tn = byId.get(e.target);
    if (!sn || !tn) continue;
    let varNode: GraphNode | null = null;
    let codeNode: GraphNode | null = null;
    if (sn.type === "env_var" || sn.type === "feature_flag" || sn.type === "secret") {
      varNode = sn;
      codeNode = tn;
    } else if (tn.type === "env_var" || tn.type === "feature_flag" || tn.type === "secret") {
      varNode = tn;
      codeNode = sn;
    }
    if (!varNode || !codeNode || !CODE_TYPES.has(codeNode.type)) continue;
    let s = seen.get(varNode.id);
    if (!s) {
      s = new Set();
      seen.set(varNode.id, s);
    }
    if (s.has(codeNode.id)) continue;
    s.add(codeNode.id);
    let list = consumersByVar.get(varNode.id);
    if (!list) {
      list = [];
      consumersByVar.set(varNode.id, list);
    }
    list.push(codeNode);
  }
  return envVars
    .map((n) => ({
      node: n,
      required: envVarRequired(n),
      consumers: consumersByVar.get(n.id) ?? [],
    }))
    .sort((a, b) => {
      // required-no-consumer first (most likely a problem), then alpha.
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.node.name.localeCompare(b.node.name);
    });
}

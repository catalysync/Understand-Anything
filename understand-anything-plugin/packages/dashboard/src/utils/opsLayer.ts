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

// ===========================================================================
// FINAL 300-SERIES WAVE — Error propagation, observability & computed metrics.
// All selectors are pure + defensive; absent enrichment → empty result.
// ===========================================================================

// ---------------------------------------------------------------------------
// Error propagation (items 92-94). A code node `raises` an `error_type`; the
// error bubbles up `calls` (callee→caller) until a node `handles`/`recovers`
// (or `wraps`) it. We compute, for a selected error_type OR a code node, the
// static bidirectional "stack trace": every raise site + the caller chain up to
// the handler that terminates it.
// ---------------------------------------------------------------------------

const RAISE_EDGE = "raises";
const HANDLE_EDGE_TYPES: ReadonlySet<string> = new Set<string>(["handles", "recovers"]);
const SWALLOW_EDGE = "swallows";
const WRAP_EDGE = "wraps";

/** All error_type nodes in the graph (sorted by severity then name). */
export function errorTypeNodes(graph: KnowledgeGraph | null): GraphNode[] {
  if (!graph) return [];
  const sevRank = (s?: string): number =>
    s === "critical" ? 0 : s === "error" ? 1 : s === "warning" ? 2 : 3;
  return graph.nodes
    .filter((n) => n.type === "error_type")
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.name.localeCompare(b.name));
}

/** Code nodes that `raises` a given error_type (the raise sites). */
export function raiseSites(graph: KnowledgeGraph | null, errorId: string): GraphNode[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const out: GraphNode[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== RAISE_EDGE) continue;
    // raises: source=code → target=error_type (accept reverse defensively).
    let codeId: string | null = null;
    if (e.target === errorId) codeId = e.source;
    else if (e.source === errorId) codeId = e.target;
    if (!codeId || seen.has(codeId)) continue;
    const code = byId.get(codeId);
    if (code && CODE_TYPES.has(code.type)) {
      seen.add(codeId);
      out.push(code);
    }
  }
  return out;
}

/** Code nodes that `handles`/`recovers` a given error_type (the handlers). */
export function handlerSites(graph: KnowledgeGraph | null, errorId: string): GraphNode[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const out: GraphNode[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!HANDLE_EDGE_TYPES.has(e.type)) continue;
    let codeId: string | null = null;
    if (e.target === errorId) codeId = e.source;
    else if (e.source === errorId) codeId = e.target;
    if (!codeId || seen.has(codeId)) continue;
    const code = byId.get(codeId);
    if (code && CODE_TYPES.has(code.type)) {
      seen.add(codeId);
      out.push(code);
    }
  }
  return out;
}

export interface ErrorPropagation {
  /** The error_type node(s) under consideration. */
  errorIds: Set<string>;
  /** Code nodes that raise (origin sites). */
  raiseIds: Set<string>;
  /** Code nodes on a propagation path between a raise and its handler. */
  pathIds: Set<string>;
  /** Code nodes that terminate the propagation (handle/recover). */
  handlerIds: Set<string>;
  /** True when at least one path reaches NO handler (uncaught escape). */
  hasUncaught: boolean;
}

/**
 * Build the propagation highlight set for a selected error_type OR code node.
 *
 * For an error_type: start at every raise site, walk UP the caller chain
 * (incoming `calls`), stopping a branch when a node handles/recovers that error.
 * For a code node: consider every error_type it raises.
 *
 * Reuses a BFS over reverse-call adjacency (the same shape as traceGraph's
 * caller walk) so the highlight matches the static stack trace UI.
 */
export function errorPropagation(graph: KnowledgeGraph | null, selectedId: string): ErrorPropagation {
  const empty: ErrorPropagation = {
    errorIds: new Set(), raiseIds: new Set(), pathIds: new Set(),
    handlerIds: new Set(), hasUncaught: false,
  };
  if (!graph) return empty;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const sel = byId.get(selectedId);
  if (!sel) return empty;

  // Resolve the set of error_type ids in scope.
  const errorIds = new Set<string>();
  if (sel.type === "error_type") {
    errorIds.add(sel.id);
  } else if (CODE_TYPES.has(sel.type)) {
    for (const e of graph.edges) {
      if (e.type !== RAISE_EDGE) continue;
      if (e.source === selectedId) {
        const t = byId.get(e.target);
        if (t?.type === "error_type") errorIds.add(t.id);
      } else if (e.target === selectedId) {
        const s = byId.get(e.source);
        if (s?.type === "error_type") errorIds.add(s.id);
      }
    }
  }
  if (errorIds.size === 0) return { ...empty, errorIds };

  // Reverse-call adjacency: callee → callers.
  const callers = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type !== "calls") continue;
    let list = callers.get(e.target);
    if (!list) { list = []; callers.set(e.target, list); }
    list.push(e.source);
  }

  // Handlers per error (code node id → handles which errors).
  const handlesError = new Map<string, Set<string>>(); // codeId → Set<errorId>
  for (const e of graph.edges) {
    if (!HANDLE_EDGE_TYPES.has(e.type)) continue;
    let codeId: string | null = null; let errId: string | null = null;
    const s = byId.get(e.source); const t = byId.get(e.target);
    if (s?.type === "error_type") { errId = s.id; codeId = e.target; }
    else if (t?.type === "error_type") { errId = t.id; codeId = e.source; }
    if (!codeId || !errId || !errorIds.has(errId)) continue;
    let set = handlesError.get(codeId);
    if (!set) { set = new Set(); handlesError.set(codeId, set); }
    set.add(errId);
  }

  const raiseIds = new Set<string>();
  for (const eid of errorIds) for (const r of raiseSites(graph, eid)) raiseIds.add(r.id);

  const pathIds = new Set<string>();
  const handlerIds = new Set<string>();
  let hasUncaught = false;

  // BFS up from each raise site; a branch terminates at a handler of the error.
  for (const start of raiseIds) {
    const queue: string[] = [start];
    const seen = new Set<string>([start]);
    pathIds.add(start);
    // A raise site that itself handles the error self-terminates.
    if ((handlesError.get(start)?.size ?? 0) > 0) { handlerIds.add(start); continue; }
    let branchReachedHandler = false;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const ups = callers.get(cur) ?? [];
      if (ups.length === 0 && cur !== start) {
        // Top of a chain with no handler — uncaught escape.
      }
      for (const up of ups) {
        if (seen.has(up)) continue;
        seen.add(up);
        pathIds.add(up);
        if ((handlesError.get(up)?.size ?? 0) > 0) {
          handlerIds.add(up);
          branchReachedHandler = true;
          // Stop walking past the handler on this branch.
          continue;
        }
        queue.push(up);
      }
    }
    if (!branchReachedHandler) hasUncaught = true;
  }

  return { errorIds, raiseIds, pathIds, handlerIds, hasUncaught };
}

export interface UncaughtError {
  error: GraphNode;
  /** Resolved nearest raise site (best-effort, first found). */
  raisedBy: GraphNode | null;
}

/**
 * "This function can fail with…" — the transitive uncaught error types reachable
 * from a code node via `calls`/`raises`, NOT caught en route by a `handles`
 * node on the path. Walks DOWN the callee chain from the node, collecting every
 * error raised by anything in the closure, minus errors the node (or an
 * intermediate) handles.
 */
export function uncaughtErrorsFor(graph: KnowledgeGraph | null, codeId: string): UncaughtError[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const start = byId.get(codeId);
  if (!start || !CODE_TYPES.has(start.type)) return [];

  // Forward-call adjacency.
  const callees = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type !== "calls") continue;
    let list = callees.get(e.source);
    if (!list) { list = []; callees.set(e.source, list); }
    list.push(e.target);
  }
  // raises / handles per code node.
  const raisesOf = new Map<string, Set<string>>();
  const handlesOf = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    const s = byId.get(e.source); const t = byId.get(e.target);
    if (e.type === RAISE_EDGE) {
      let code: string | null = null; let err: string | null = null;
      if (s && CODE_TYPES.has(s.type) && t?.type === "error_type") { code = s.id; err = t.id; }
      else if (t && CODE_TYPES.has(t.type) && s?.type === "error_type") { code = t.id; err = s.id; }
      if (code && err) { let x = raisesOf.get(code); if (!x) { x = new Set(); raisesOf.set(code, x); } x.add(err); }
    } else if (HANDLE_EDGE_TYPES.has(e.type)) {
      let code: string | null = null; let err: string | null = null;
      if (s && CODE_TYPES.has(s.type) && t?.type === "error_type") { code = s.id; err = t.id; }
      else if (t && CODE_TYPES.has(t.type) && s?.type === "error_type") { code = t.id; err = s.id; }
      if (code && err) { let x = handlesOf.get(code); if (!x) { x = new Set(); handlesOf.set(code, x); } x.add(err); }
    }
  }

  // Errors the start node catches itself are never uncaught at its boundary.
  const caughtAtStart = handlesOf.get(codeId) ?? new Set<string>();

  // DFS the callee closure; collect raised errors not handled along the path
  // from start to that raise site.
  const uncaughtByError = new Map<string, GraphNode>(); // errorId → raise site
  const visit = (id: string, handledOnPath: Set<string>, depth: number) => {
    if (depth > 12) return;
    const nowHandled = new Set(handledOnPath);
    for (const h of handlesOf.get(id) ?? []) nowHandled.add(h);
    for (const errId of raisesOf.get(id) ?? []) {
      if (nowHandled.has(errId) || caughtAtStart.has(errId)) continue;
      if (!uncaughtByError.has(errId)) uncaughtByError.set(errId, byId.get(id) ?? start);
    }
    for (const nxt of callees.get(id) ?? []) {
      const child = byId.get(nxt);
      if (!child || !CODE_TYPES.has(child.type)) continue;
      visit(nxt, nowHandled, depth + 1);
    }
  };
  visit(codeId, new Set(), 0);

  const out: UncaughtError[] = [];
  for (const [errId, site] of uncaughtByError) {
    const err = byId.get(errId);
    if (!err) continue;
    out.push({ error: err, raisedBy: site.id === codeId ? null : site });
  }
  const sevRank = (s?: string) => (s === "critical" ? 0 : s === "error" ? 1 : s === "warning" ? 2 : 3);
  return out.sort((a, b) => sevRank(a.error.severity) - sevRank(b.error.severity) || a.error.name.localeCompare(b.error.name));
}

/** True if the graph has ANY error-propagation enrichment (gate for UI). */
export function hasErrorLayer(graph: KnowledgeGraph | null): boolean {
  if (!graph) return false;
  for (const e of graph.edges) {
    if (e.type === RAISE_EDGE || HANDLE_EDGE_TYPES.has(e.type) || e.type === SWALLOW_EDGE || e.type === WRAP_EDGE) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Swallowed-error markers (item 95). A node that is the target (or source) of a
// `swallows` edge has an empty / log-only / broad catch. We badge those nodes.
// ---------------------------------------------------------------------------

/** Set of code-node ids that swallow an error (empty/log-only/broad catch). */
export function swallowedErrorNodeIds(graph: KnowledgeGraph | null): Set<string> {
  const out = new Set<string>();
  if (!graph) return out;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  for (const e of graph.edges) {
    if (e.type !== SWALLOW_EDGE) continue;
    // swallows: source=code(catch site) → target=error_type. Mark the code end.
    const s = byId.get(e.source); const t = byId.get(e.target);
    if (s && CODE_TYPES.has(s.type)) out.add(s.id);
    else if (t && CODE_TYPES.has(t.type)) out.add(t.id);
  }
  return out;
}

/** error_type nodes a code node swallows (for the NodeInfo / inspector). */
export function swallowedErrorsFor(graph: KnowledgeGraph | null, codeId: string): GraphNode[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const out: GraphNode[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== SWALLOW_EDGE) continue;
    let errId: string | null = null;
    if (e.source === codeId) errId = e.target;
    else if (e.target === codeId) errId = e.source;
    if (!errId || seen.has(errId)) continue;
    const err = byId.get(errId);
    if (err && err.type === "error_type") { seen.add(errId); out.push(err); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Observability (items 99-103). For a code node: its log_site / span_site /
// metric nodes (via logs / instruments|enriches_span / emits_metric) + alerts.
// ---------------------------------------------------------------------------

const LOG_EDGES: ReadonlySet<string> = new Set(["logs"]);
const SPAN_EDGES: ReadonlySet<string> = new Set(["instruments", "enriches_span"]);
const METRIC_EDGES: ReadonlySet<string> = new Set(["emits_metric"]);
const ALERT_EDGES: ReadonlySet<string> = new Set(["alerts_on"]);

export interface ObservabilitySummary {
  logs: GraphNode[];
  spans: GraphNode[];
  metrics: GraphNode[];
  alerts: GraphNode[];
}

/** True if a node is a log/span/metric/alert (any telemetry node). */
function isTelemetryNode(n: GraphNode | undefined): boolean {
  return !!n && (n.type === "log_site" || n.type === "span_site" || n.type === "metric" || n.type === "alert");
}

/** Observability summary for a code node (or empty). */
export function observabilityFor(graph: KnowledgeGraph | null, codeId: string): ObservabilitySummary {
  const out: ObservabilitySummary = { logs: [], spans: [], metrics: [], alerts: [] };
  if (!graph) return out;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const seen = new Set<string>();
  const push = (arr: GraphNode[], other: GraphNode | undefined) => {
    if (!other || seen.has(other.id)) return;
    seen.add(other.id);
    arr.push(other);
  };
  for (const e of graph.edges) {
    const isS = e.source === codeId; const isT = e.target === codeId;
    if (!isS && !isT) continue;
    const other = byId.get(isS ? e.target : e.source);
    if (!isTelemetryNode(other)) continue;
    if (LOG_EDGES.has(e.type) || other!.type === "log_site") push(out.logs, other);
    else if (SPAN_EDGES.has(e.type) || other!.type === "span_site") push(out.spans, other);
    else if (METRIC_EDGES.has(e.type) || other!.type === "metric") push(out.metrics, other);
    else if (ALERT_EDGES.has(e.type) || other!.type === "alert") push(out.alerts, other);
  }
  return out;
}

/** Level + template strip for a log_site (best-effort from attrs/tags/summary). */
export function logSiteDetail(n: GraphNode): { level: string | null; template: string | null } {
  const a = n.attrs ?? {};
  const level =
    (typeof a.level === "string" ? a.level : null) ??
    (n.tags ?? []).find((t) => ["debug", "info", "warn", "warning", "error", "fatal", "trace"].includes(t.toLowerCase())) ??
    null;
  const template =
    (typeof a.template === "string" ? a.template : null) ??
    (typeof a.message === "string" ? a.message : null) ??
    (n.summary && n.summary.length <= 120 ? n.summary : null);
  return { level: level ? level.toUpperCase() : null, template };
}

/** True if the graph has ANY observability enrichment (gate for UI). */
export function hasObservabilityLayer(graph: KnowledgeGraph | null): boolean {
  if (!graph) return false;
  for (const n of graph.nodes) if (isTelemetryNode(n)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Instrumentation-coverage heat (items 99/101-102). Tri-state for code nodes:
//   green  = instrumented (emits a log_site / span_site / metric)
//   amber  = auto-covered (reachable from an entrypoint, but no telemetry)
//   red    = telemetry-dark (no log/span/metric on any path, unreachable)
// ---------------------------------------------------------------------------

export type InstrumentationState = "instrumented" | "auto" | "dark";

export interface InstrumentationInfo {
  state: InstrumentationState;
  /** count of telemetry nodes directly attached. */
  telemetryCount: number;
}

/** Map every code node → its instrumentation tri-state. */
export function buildInstrumentationInfo(graph: KnowledgeGraph | null): Map<string, InstrumentationInfo> {
  const info = new Map<string, InstrumentationInfo>();
  if (!graph) return info;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));

  // Directly-instrumented count per code node.
  const telemetryCount = new Map<string, number>();
  for (const e of graph.edges) {
    if (!LOG_EDGES.has(e.type) && !SPAN_EDGES.has(e.type) && !METRIC_EDGES.has(e.type)) continue;
    const s = byId.get(e.source); const t = byId.get(e.target);
    let codeId: string | null = null;
    if (s && CODE_TYPES.has(s.type) && isTelemetryNode(t)) codeId = s.id;
    else if (t && CODE_TYPES.has(t.type) && isTelemetryNode(s)) codeId = t.id;
    if (codeId) telemetryCount.set(codeId, (telemetryCount.get(codeId) ?? 0) + 1);
  }

  // Auto-covered: reachable from any entrypoint.
  const roots = allEntrypointIds(graph);
  const live = roots.length > 0 ? reachableFrom(graph, roots) : new Set<string>();

  for (const n of graph.nodes) {
    if (!CODE_TYPES.has(n.type)) continue;
    const tc = telemetryCount.get(n.id) ?? 0;
    let state: InstrumentationState;
    if (tc > 0) state = "instrumented";
    else if (live.has(n.id)) state = "auto";
    else state = "dark";
    info.set(n.id, { state, telemetryCount: tc });
  }
  return info;
}

/** True if the graph supports the instrumentation heat overlay. */
export function hasInstrumentationData(graph: KnowledgeGraph | null): boolean {
  return hasObservabilityLayer(graph);
}

// ---------------------------------------------------------------------------
// Computed / derived metrics for the deep inspector "Computed" tab (114-121).
// ---------------------------------------------------------------------------

export interface ComputedMetrics {
  fanIn: number;
  fanOut: number;
  callFanIn: number;
  callFanOut: number;
  complexity: string;
  /** Longest transitive dependency depth via `calls` (callee direction). */
  depDepth: number;
  layer: string | null;
  /** Distinct uncaught error types that escape this node. */
  escapingErrors: number;
  /** True if the node lies on the critical (longest) call path from itself. */
  onCriticalPath: boolean;
  /** Number of nodes on its longest downstream call path (incl. itself). */
  criticalPathLen: number;
}

/** Compute the derived metrics block for a code node. */
export function computedMetricsFor(graph: KnowledgeGraph | null, codeId: string): ComputedMetrics | null {
  if (!graph) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const node = byId.get(codeId);
  if (!node) return null;

  let fanIn = 0, fanOut = 0, callFanIn = 0, callFanOut = 0;
  const callees: string[] = [];
  for (const e of graph.edges) {
    if (e.source === codeId) {
      fanOut += 1;
      if (e.type === "calls") { callFanOut += 1; callees.push(e.target); }
    }
    if (e.target === codeId) {
      fanIn += 1;
      if (e.type === "calls") callFanIn += 1;
    }
  }

  // Transitive dep depth (longest downstream `calls` chain), cycle-safe.
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type !== "calls") continue;
    let l = adj.get(e.source); if (!l) { l = []; adj.set(e.source, l); } l.push(e.target);
  }
  const memo = new Map<string, number>();
  const inStack = new Set<string>();
  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (inStack.has(id)) return 0;
    inStack.add(id);
    let best = 0;
    for (const nxt of adj.get(id) ?? []) best = Math.max(best, 1 + depth(nxt));
    inStack.delete(id);
    memo.set(id, best);
    return best;
  };
  const depDepth = depth(codeId);

  // Layer membership.
  let layer: string | null = null;
  for (const l of graph.layers) {
    if (l.nodeIds.includes(codeId)) { layer = l.name; break; }
  }

  const escapingErrors = uncaughtErrorsFor(graph, codeId).length;
  const criticalPathLen = depDepth + 1;
  const onCriticalPath = callFanOut > 0 && depDepth >= 1;

  return {
    fanIn, fanOut, callFanIn, callFanOut,
    complexity: node.complexity,
    depDepth, layer, escapingErrors,
    onCriticalPath, criticalPathLen,
  };
}

// ---------------------------------------------------------------------------
// Inspector "Usages" + "Structure" helpers (114-117).
// ---------------------------------------------------------------------------

export interface UsageRow {
  node: GraphNode;
  outgoing: boolean;
}
export interface UsageGroup {
  edgeType: string;
  label: string;
  /** Rows grouped by directory of the other node's filePath. */
  byDir: { dir: string; rows: UsageRow[] }[];
  total: number;
}

const USAGE_EDGE_TYPES: ReadonlySet<string> = new Set(["calls", "imports", "implements", "inherits"]);

function dirOf(n: GraphNode): string {
  const fp = n.filePath ?? "";
  const idx = fp.lastIndexOf("/");
  return idx >= 0 ? fp.slice(0, idx) : (fp || "—");
}

/** Usages grouped by edge kind then directory (for the inspector Usages tab). */
export function usagesForNode(graph: KnowledgeGraph | null, codeId: string): UsageGroup[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  // edgeType+direction → label → rows
  const buckets = new Map<string, { label: string; rows: UsageRow[] }>();
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!USAGE_EDGE_TYPES.has(e.type)) continue;
    const isS = e.source === codeId; const isT = e.target === codeId;
    if (!isS && !isT) continue;
    const other = byId.get(isS ? e.target : e.source);
    if (!other) continue;
    const key = `${e.type}:${isS ? "out" : "in"}`;
    if (seen.has(`${key}:${other.id}`)) continue;
    seen.add(`${key}:${other.id}`);
    const label = relationLabel(e.type, isS);
    let b = buckets.get(key);
    if (!b) { b = { label, rows: [] }; buckets.set(key, b); }
    b.rows.push({ node: other, outgoing: isS });
  }
  const groups: UsageGroup[] = [];
  for (const [key, b] of buckets) {
    const edgeType = key.split(":")[0];
    const byDirMap = new Map<string, UsageRow[]>();
    for (const r of b.rows) {
      const d = dirOf(r.node);
      let l = byDirMap.get(d); if (!l) { l = []; byDirMap.set(d, l); } l.push(r);
    }
    const byDir = [...byDirMap.entries()]
      .map(([dir, rows]) => ({ dir, rows: rows.sort((x, y) => x.node.name.localeCompare(y.node.name)) }))
      .sort((a, b2) => a.dir.localeCompare(b2.dir));
    groups.push({ edgeType, label: b.label, byDir, total: b.rows.length });
  }
  return groups.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export interface SymbolChild {
  node: GraphNode;
  kind: string;
}

/** A code node's internal symbol tree — its `contains` children (methods/fields). */
export function symbolChildren(graph: KnowledgeGraph | null, codeId: string): SymbolChild[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const out: SymbolChild[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== "contains" || e.source !== codeId) continue;
    if (seen.has(e.target)) continue;
    const child = byId.get(e.target);
    if (!child) continue;
    seen.add(e.target);
    out.push({ node: child, kind: child.type });
  }
  return out;
}

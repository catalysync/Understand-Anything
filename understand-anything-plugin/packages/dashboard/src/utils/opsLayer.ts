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

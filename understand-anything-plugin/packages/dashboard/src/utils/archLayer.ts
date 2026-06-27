// ── Architecture & API-surface tier (300-series items 9-10, 21-22, 25-26, 28) ──
//
// Pure functions over the KnowledgeGraph — no React, no store. They power:
//   • Architecture boundary rules (26)  — layer-import-violation detection
//   • Public-surface vs internal (21)    — node visibility classification
//   • Event-bus map + orphans (9-10)     — event/topic producer/consumer index
//   • Route → domain-flow bridge (28)    — handler-file → domain-step resolution
//   • API-surface snapshot (22)          — exported public symbols per file
//
// Everything is defensive: returns empty results gracefully so the UIs render
// clean empty-states. No data is fabricated.
import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  NodeType,
} from "@understand-anything/core/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Code node types that participate in architecture / visibility analysis. */
const ARCH_CODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "file", "function", "class", "module",
]);

/** Build a (nodeId → layerId) map, first-matching-layer wins (mirrors store). */
export function buildNodeLayerMap(graph: KnowledgeGraph): Map<string, string> {
  const m = new Map<string, string>();
  for (const layer of graph.layers) {
    for (const id of layer.nodeIds) if (!m.has(id)) m.set(id, layer.id);
  }
  return m;
}

/** Layer id → its index (architectural order) in graph.layers. */
export function buildLayerOrder(graph: KnowledgeGraph): Map<string, number> {
  const m = new Map<string, number>();
  graph.layers.forEach((l, i) => m.set(l.id, i));
  return m;
}

// ===========================================================================
// 1. Architecture boundary rules (item 26)
// ===========================================================================

/**
 * A boundary rule forbids `imports` edges crossing from one layer into another.
 * `fromLayerId` may be "*" (any layer) to express "nothing may import into
 * <toLayerId>" style guards; likewise `toLayerId` may be "*".
 *
 * `id` is stable so localStorage can persist enabled/disabled state, and
 * `derived` marks the auto-generated "no upward dependency" defaults.
 */
export interface BoundaryRule {
  id: string;
  fromLayerId: string;
  toLayerId: string;
  enabled: boolean;
  /** True for auto-derived "no upward deps" rules (vs user-added). */
  derived?: boolean;
}

/** A single import edge that violates an enabled boundary rule. */
export interface BoundaryViolation {
  edge: GraphEdge;
  source: GraphNode;
  target: GraphNode;
  fromLayerId: string;
  toLayerId: string;
  fromLayerName: string;
  toLayerName: string;
  ruleId: string;
  /** "src->tgt" key for highlighting (mirrors cycleEdgeKeys). */
  edgeKey: string;
}

const IMPORT_EDGE_TYPES: ReadonlySet<string> = new Set(["imports"]);

/**
 * Default rule set: "no upward dependencies". Layers are ordered top→bottom in
 * graph.layers; a higher-index (lower-level) layer importing a lower-index
 * (higher-level) layer is an upward dependency. We derive one rule per ordered
 * pair (lower-level → higher-level) collapsed to a compact form: a single rule
 * per (fromLayer, toLayer) where fromIndex > toIndex.
 *
 * To keep the editable list small we emit ONE derived rule per layer that
 * forbids it from importing ANY strictly-higher layer ("* upward"), encoded as
 * fromLayerId=<layer>, toLayerId="^above". The matcher expands "^above".
 */
export function deriveDefaultRules(graph: KnowledgeGraph): BoundaryRule[] {
  const rules: BoundaryRule[] = [];
  graph.layers.forEach((layer, i) => {
    // Only layers that actually have a higher layer above them.
    if (i === 0) return;
    rules.push({
      id: `derived:noup:${layer.id}`,
      fromLayerId: layer.id,
      toLayerId: "^above",
      enabled: true,
      derived: true,
    });
  });
  return rules;
}

/**
 * Compute every import edge that violates an enabled rule. The "^above"
 * pseudo-target matches any layer with a strictly-lower index than the source
 * layer (an upward dependency). "*" matches any layer.
 */
export function computeBoundaryViolations(
  graph: KnowledgeGraph | null,
  rules: BoundaryRule[],
): BoundaryViolation[] {
  if (!graph) return [];
  const nodeLayer = buildNodeLayerMap(graph);
  const order = buildLayerOrder(graph);
  const layerName = new Map(graph.layers.map((l) => [l.id, l.name] as const));
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const active = rules.filter((r) => r.enabled);
  if (active.length === 0) return [];

  const out: BoundaryViolation[] = [];
  const seen = new Set<string>();

  for (const edge of graph.edges) {
    if (!IMPORT_EDGE_TYPES.has(edge.type)) continue;
    const fromLayer = nodeLayer.get(edge.source);
    const toLayer = nodeLayer.get(edge.target);
    if (!fromLayer || !toLayer || fromLayer === toLayer) continue;

    // Find the first matching enabled rule for this crossing.
    const rule = active.find((r) => {
      if (r.fromLayerId !== "*" && r.fromLayerId !== fromLayer) return false;
      if (r.toLayerId === "*") return true;
      if (r.toLayerId === "^above") {
        const fi = order.get(fromLayer);
        const ti = order.get(toLayer);
        return fi !== undefined && ti !== undefined && ti < fi;
      }
      return r.toLayerId === toLayer;
    });
    if (!rule) continue;

    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const edgeKey = `${edge.source}->${edge.target}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    out.push({
      edge,
      source,
      target,
      fromLayerId: fromLayer,
      toLayerId: toLayer,
      fromLayerName: layerName.get(fromLayer) ?? fromLayer,
      toLayerName: layerName.get(toLayer) ?? toLayer,
      ruleId: rule.id,
      edgeKey,
    });
  }
  return out;
}

/** Violation edge keys ("src->tgt") for GraphView edge highlighting. */
export function violationEdgeKeySet(violations: BoundaryViolation[]): Set<string> {
  return new Set(violations.map((v) => v.edgeKey));
}

/**
 * Layer-pair keys ("a|b", unordered) that contain at least one violation — used
 * to recolor aggregated layer→layer edges in the overview.
 */
export function violationLayerPairKeys(violations: BoundaryViolation[]): Set<string> {
  const s = new Set<string>();
  for (const v of violations) {
    const [a, b] =
      v.fromLayerId < v.toLayerId
        ? [v.fromLayerId, v.toLayerId]
        : [v.toLayerId, v.fromLayerId];
    s.add(`${a}|${b}`);
  }
  return s;
}

// ===========================================================================
// 2. Public-surface vs internal partition (item 21)
// ===========================================================================

export type Visibility = "public" | "internal";

/**
 * Classify each code node as public or internal. A node is PUBLIC when it is
 * exported (an outgoing/incoming `exports` edge touches it, or it is referenced
 * — via any structural edge — from a node in a DIFFERENT layer or file).
 * Otherwise it is internal.
 *
 * Heuristic, robust to sparse graphs: nodes never referenced cross-boundary are
 * internal; everything reachable across a layer/file boundary is public.
 */
export function computeVisibility(
  graph: KnowledgeGraph | null,
): Map<string, Visibility> {
  const result = new Map<string, Visibility>();
  if (!graph) return result;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const nodeLayer = buildNodeLayerMap(graph);

  const publicIds = new Set<string>();

  for (const edge of graph.edges) {
    const s = byId.get(edge.source);
    const t = byId.get(edge.target);
    if (!s || !t) continue;

    // An explicit `exports` edge marks the exported member as public.
    if (edge.type === "exports") {
      publicIds.add(edge.target);
      continue;
    }

    // A cross-layer / cross-file reference of any structural kind exposes the
    // referenced (target) node as part of the surface its consumers see.
    const sameFile =
      s.filePath && t.filePath && s.filePath === t.filePath;
    const sl = nodeLayer.get(s.id);
    const tl = nodeLayer.get(t.id);
    const sameLayer = sl && tl && sl === tl;
    if (!sameFile && !sameLayer) {
      // The target is referenced from outside its own file & layer → public.
      if (ARCH_CODE_TYPES.has(t.type)) publicIds.add(t.id);
    }
  }

  for (const node of graph.nodes) {
    if (!ARCH_CODE_TYPES.has(node.type)) {
      // Non-code nodes (routes, tables, …) are inherently "surface"; classify
      // them as public so they're never hidden by the public-only filter.
      result.set(node.id, "public");
      continue;
    }
    result.set(node.id, publicIds.has(node.id) ? "public" : "internal");
  }
  return result;
}

// ===========================================================================
// 3. Event-bus map + orphan detector (items 9-10)
// ===========================================================================

const PRODUCE_EDGE_TYPES: ReadonlySet<string> = new Set([
  "emits_event", "publishes_to",
]);
const CONSUME_EDGE_TYPES: ReadonlySet<string> = new Set([
  "consumes_event", "subscribes_to",
]);

export type EventOrphan = "produced-never-consumed" | "consumed-never-produced" | null;

export interface EventBusEntry {
  node: GraphNode;
  producers: GraphNode[];
  consumers: GraphNode[];
  orphan: EventOrphan;
}

/**
 * Index every `event` / `topic` node with its producers and consumers, and flag
 * orphans:
 *   • produced-never-consumed (red)    — has producers but no consumers
 *   • consumed-never-produced (amber)  — has consumers but no producers
 * An event with neither side is left un-flagged (nothing wired yet).
 */
export function eventBusMap(graph: KnowledgeGraph | null): EventBusEntry[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const eventNodes = graph.nodes.filter(
    (n) => n.type === "event" || n.type === "topic",
  );
  if (eventNodes.length === 0) return [];
  const eventIds = new Set(eventNodes.map((n) => n.id));

  const producers = new Map<string, Set<string>>();
  const consumers = new Map<string, Set<string>>();
  for (const id of eventIds) {
    producers.set(id, new Set());
    consumers.set(id, new Set());
  }

  const add = (m: Map<string, Set<string>>, eventId: string, codeId: string) => {
    const set = m.get(eventId);
    if (set) set.add(codeId);
  };

  for (const edge of graph.edges) {
    const isProduce = PRODUCE_EDGE_TYPES.has(edge.type);
    const isConsume = CONSUME_EDGE_TYPES.has(edge.type);
    if (!isProduce && !isConsume) continue;
    // The event node may be on either end; the other end is the code node.
    const eventId = eventIds.has(edge.target)
      ? edge.target
      : eventIds.has(edge.source)
        ? edge.source
        : null;
    if (!eventId) continue;
    const codeId = eventId === edge.target ? edge.source : edge.target;
    if (isProduce) add(producers, eventId, codeId);
    else add(consumers, eventId, codeId);
  }

  const entries: EventBusEntry[] = eventNodes.map((node) => {
    const prod = [...(producers.get(node.id) ?? [])]
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => !!n);
    const cons = [...(consumers.get(node.id) ?? [])]
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => !!n);
    let orphan: EventOrphan = null;
    if (prod.length > 0 && cons.length === 0) orphan = "produced-never-consumed";
    else if (cons.length > 0 && prod.length === 0) orphan = "consumed-never-produced";
    return { node, producers: prod, consumers: cons, orphan };
  });

  // Orphans first (red, then amber), then by name.
  const rank = (o: EventOrphan) =>
    o === "produced-never-consumed" ? 0 : o === "consumed-never-produced" ? 1 : 2;
  entries.sort((a, b) => {
    const r = rank(a.orphan) - rank(b.orphan);
    return r !== 0 ? r : a.node.name.localeCompare(b.node.name);
  });
  return entries;
}

/** True if the graph has any event/topic node (gate for the panel). */
export function hasEventBus(graph: KnowledgeGraph | null): boolean {
  if (!graph) return false;
  return graph.nodes.some((n) => n.type === "event" || n.type === "topic");
}

// ===========================================================================
// 6. API-surface snapshot (item 22)
// ===========================================================================

export interface ApiSurfaceSymbol {
  node: GraphNode;
}

export interface ApiSurfaceFile {
  /** File / module label (filePath or node name). */
  label: string;
  filePath: string | null;
  layerId: string | null;
  layerName: string | null;
  symbols: GraphNode[];
}

/**
 * Build the committable public-API listing: every PUBLIC code symbol (function/
 * class/module — not whole-file nodes) grouped by its owning file, with a
 * fallback bucket for symbols lacking a filePath. Uses computeVisibility so the
 * snapshot matches the public-surface filter.
 */
export function apiSurface(graph: KnowledgeGraph | null): ApiSurfaceFile[] {
  if (!graph) return [];
  const visibility = computeVisibility(graph);
  const nodeLayer = buildNodeLayerMap(graph);
  const layerName = new Map(graph.layers.map((l) => [l.id, l.name] as const));

  // Public symbols that represent an actual API member (skip file nodes — those
  // are containers; their public members are listed individually).
  const symbols = graph.nodes.filter(
    (n) =>
      visibility.get(n.id) === "public" &&
      (n.type === "function" || n.type === "class" || n.type === "module"),
  );

  const byFile = new Map<string, ApiSurfaceFile>();
  for (const sym of symbols) {
    const key = sym.filePath ?? "(no file)";
    let bucket = byFile.get(key);
    if (!bucket) {
      const lid = nodeLayer.get(sym.id) ?? null;
      bucket = {
        label: sym.filePath ?? "(no file)",
        filePath: sym.filePath ?? null,
        layerId: lid,
        layerName: lid ? layerName.get(lid) ?? null : null,
        symbols: [],
      };
      byFile.set(key, bucket);
    }
    bucket.symbols.push(sym);
  }

  const files = [...byFile.values()];
  for (const f of files) f.symbols.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.label.localeCompare(b.label));
  return files;
}

/** Render the API surface as committable Markdown. */
export function apiSurfaceMarkdown(
  files: ApiSurfaceFile[],
  projectName?: string,
): string {
  const lines: string[] = [];
  lines.push(`# Public API surface${projectName ? ` — ${projectName}` : ""}`);
  lines.push("");
  if (files.length === 0) {
    lines.push("_No public symbols detected._");
    return lines.join("\n");
  }
  const total = files.reduce((n, f) => n + f.symbols.length, 0);
  lines.push(`${total} public symbol${total === 1 ? "" : "s"} across ${files.length} file${files.length === 1 ? "" : "s"}.`);
  lines.push("");
  for (const f of files) {
    lines.push(`## \`${f.label}\`${f.layerName ? ` — ${f.layerName}` : ""}`);
    for (const s of f.symbols) {
      const kind = s.type;
      lines.push(`- \`${s.name}\` (${kind})`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

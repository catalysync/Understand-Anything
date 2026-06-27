import type { KnowledgeGraph, GraphNode, GraphEdge } from "@understand-anything/core/types";

/**
 * Shared, pure helpers for the domain business-flow features (91/93/99/100/101/
 * 113/123). Kept framework-free so they can be memoized in components and unit-
 * reasoned about independently of React Flow.
 */

export interface FlowWithSteps {
  flow: GraphNode;
  steps: { node: GraphNode; order: number }[];
}

/** All flows of a domain, each with its ordered steps. */
export function flowsForDomain(
  graph: KnowledgeGraph,
  domainId: string,
): FlowWithSteps[] {
  const flowIds = graph.edges
    .filter((e) => e.type === "contains_flow" && e.source === domainId)
    .map((e) => e.target);
  const flowById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  return flowIds
    .map((fid) => flowById.get(fid))
    .filter((n): n is GraphNode => !!n)
    .map((flow) => {
      const steps = graph.edges
        .filter((e) => e.type === "flow_step" && e.source === flow.id)
        .map((e) => ({ node: flowById.get(e.target), order: e.weight }))
        .filter((s): s is { node: GraphNode; order: number } => !!s.node)
        .sort((a, b) => a.order - b.order);
      return { flow, steps };
    });
}

/** Steps of a single flow, ordered by flow_step weight. */
export function stepsForFlow(graph: KnowledgeGraph, flowId: string): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  return graph.edges
    .filter((e) => e.type === "flow_step" && e.source === flowId)
    .sort((a, b) => a.weight - b.weight)
    .map((e) => byId.get(e.target))
    .filter((n): n is GraphNode => !!n);
}

/** cross_domain edges touching a given domain id. */
export function crossDomainEdgesFor(
  graph: KnowledgeGraph,
  domainId: string,
): GraphEdge[] {
  return graph.edges.filter(
    (e) =>
      e.type === "cross_domain" &&
      (e.source === domainId || e.target === domainId),
  );
}

/**
 * Feature 99: longest directed chain through `cross_domain` edges
 * (push→build→deploy→billing). Treats forward/backward edges directionally,
 * bidirectional as both. Returns the ordered list of domain ids; empty if no
 * cross_domain edges. Uses DFS over a DAG-ish graph with cycle guarding.
 */
export function longestCrossDomainChain(graph: KnowledgeGraph): string[] {
  const adj = new Map<string, Set<string>>();
  const domainIds = new Set(
    graph.nodes.filter((n) => n.type === "domain").map((n) => n.id),
  );
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of graph.edges) {
    if (e.type !== "cross_domain") continue;
    if (e.direction === "backward") add(e.target, e.source);
    else if (e.direction === "bidirectional") {
      add(e.source, e.target);
      add(e.target, e.source);
    } else add(e.source, e.target);
  }
  if (adj.size === 0) return [];

  let best: string[] = [];
  const memo = new Map<string, string[]>();
  const dfs = (node: string, onStack: Set<string>): string[] => {
    const cached = memo.get(node);
    if (cached) return cached;
    let longest: string[] = [node];
    for (const next of adj.get(node) ?? []) {
      if (onStack.has(next)) continue; // cycle guard
      onStack.add(next);
      const sub = [node, ...dfs(next, onStack)];
      onStack.delete(next);
      if (sub.length > longest.length) longest = sub;
    }
    memo.set(node, longest);
    return longest;
  };
  for (const start of domainIds) {
    const onStack = new Set<string>([start]);
    const chain = dfs(start, onStack);
    if (chain.length > best.length) best = chain;
  }
  return best;
}

/** The cross_domain edge connecting two adjacent domains in a chain. */
export function edgeBetween(
  graph: KnowledgeGraph,
  source: string,
  target: string,
): GraphEdge | undefined {
  return graph.edges.find(
    (e) =>
      e.type === "cross_domain" &&
      ((e.source === source && e.target === target) ||
        (e.direction === "bidirectional" &&
          e.source === target &&
          e.target === source)),
  );
}

/** Map a cross_domain weight (0–1) to a stroke width in px (feature 101). */
export function weightToStrokeWidth(weight: number): number {
  const w = Math.max(0, Math.min(1, weight));
  return 1 + w * 5; // 1px..6px
}

/** Map a cross_domain weight (0–1) to a stroke opacity (feature 101). */
export function weightToOpacity(weight: number): number {
  const w = Math.max(0, Math.min(1, weight));
  return 0.35 + w * 0.55; // 0.35..0.9
}

export interface DomainSearchHit {
  node: GraphNode;
  kind: "domain" | "flow" | "step" | "entity";
  /** The domain id to navigate into for this hit. */
  domainId: string;
  /** For entity hits, the entity text matched. */
  entity?: string;
  matchedField: string;
}

/**
 * Feature 113: search domains/flows/steps/entities by name/summary.
 * Returns hits with the domain to jump into.
 */
export function searchDomainGraph(
  graph: KnowledgeGraph,
  rawQuery: string,
): DomainSearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  // Build node→owning-domain map via contains_flow / flow_step edges.
  const flowToDomain = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type === "contains_flow") flowToDomain.set(e.target, e.source);
  }
  const stepToDomain = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type === "flow_step") {
      const d = flowToDomain.get(e.source);
      if (d) stepToDomain.set(e.target, d);
    }
  }

  const hits: DomainSearchHit[] = [];
  const matches = (s: string | undefined) => !!s && s.toLowerCase().includes(q);

  for (const node of graph.nodes) {
    if (node.type === "domain") {
      if (matches(node.name) || matches(node.summary)) {
        hits.push({
          node,
          kind: "domain",
          domainId: node.id,
          matchedField: matches(node.name) ? "name" : "summary",
        });
      }
      const entities = (node.domainMeta?.entities ?? []) as string[];
      for (const ent of entities) {
        if (matches(ent)) {
          hits.push({
            node,
            kind: "entity",
            domainId: node.id,
            entity: ent,
            matchedField: "entity",
          });
        }
      }
    } else if (node.type === "flow") {
      if (matches(node.name) || matches(node.summary)) {
        const domainId = flowToDomain.get(node.id);
        if (domainId)
          hits.push({
            node,
            kind: "flow",
            domainId,
            matchedField: matches(node.name) ? "name" : "summary",
          });
      }
    } else if (node.type === "step") {
      if (matches(node.name) || matches(node.summary) || matches(node.filePath)) {
        const domainId = stepToDomain.get(node.id);
        if (domainId)
          hits.push({
            node,
            kind: "step",
            domainId,
            matchedField: matches(node.name)
              ? "name"
              : matches(node.filePath)
                ? "file"
                : "summary",
          });
      }
    }
  }

  // Rank: domains, then flows, then entities, then steps; cap to keep it snappy.
  const rank: Record<DomainSearchHit["kind"], number> = {
    domain: 0,
    flow: 1,
    entity: 2,
    step: 3,
  };
  return hits.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 40);
}

// ── 200-series domain polish long-tail (104/114/117/118/119) ────────────────

/**
 * Item 104: in/out degree of each domain over `cross_domain` edges (respecting
 * direction). A domain with 0 inbound is an "entry" (▶); 0 outbound a
 * "terminal" (■). Bidirectional edges count for both endpoints.
 */
export interface DomainDegree {
  inDeg: number;
  outDeg: number;
  isEntry: boolean;
  isTerminal: boolean;
}
export function domainDegrees(
  graph: KnowledgeGraph,
): Map<string, DomainDegree> {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const domainIds = graph.nodes
    .filter((n) => n.type === "domain")
    .map((n) => n.id);
  for (const id of domainIds) {
    inDeg.set(id, 0);
    outDeg.set(id, 0);
  }
  const bumpOut = (id: string) => outDeg.set(id, (outDeg.get(id) ?? 0) + 1);
  const bumpIn = (id: string) => inDeg.set(id, (inDeg.get(id) ?? 0) + 1);
  for (const e of graph.edges) {
    if (e.type !== "cross_domain") continue;
    if (e.direction === "backward") {
      bumpOut(e.target);
      bumpIn(e.source);
    } else if (e.direction === "bidirectional") {
      bumpOut(e.source);
      bumpIn(e.target);
      bumpOut(e.target);
      bumpIn(e.source);
    } else {
      bumpOut(e.source);
      bumpIn(e.target);
    }
  }
  const out = new Map<string, DomainDegree>();
  for (const id of domainIds) {
    const i = inDeg.get(id) ?? 0;
    const o = outDeg.get(id) ?? 0;
    out.set(id, {
      inDeg: i,
      outDeg: o,
      // Only meaningful when the domain actually participates in some edge.
      isEntry: i === 0 && o > 0,
      isTerminal: o === 0 && i > 0,
    });
  }
  return out;
}

/** Map domainId → flow count via contains_flow edges (items 119/103). */
export function flowCountByDomain(graph: KnowledgeGraph): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type === "contains_flow")
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
  }
  return m;
}

/**
 * Item 114: the set of flow + step node ids that "touch" a given entity. A
 * flow touches the entity when its owning domain lists the entity in
 * domainMeta.entities, or the flow/step name/summary mentions it. Returns ids
 * for dimming the rest.
 */
export function nodesTouchingEntity(
  graph: KnowledgeGraph,
  entity: string,
): Set<string> {
  const ent = entity.trim().toLowerCase();
  const touched = new Set<string>();
  if (!ent) return touched;

  // domain → owns entity?
  const domainOwns = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type !== "domain") continue;
    const ents = ((n.domainMeta?.entities ?? []) as string[]).map((e) =>
      e.toLowerCase(),
    );
    if (ents.includes(ent)) domainOwns.add(n.id);
  }
  // flow → domain, step → flow lookups.
  const flowToDomain = new Map<string, string>();
  const stepToFlow = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type === "contains_flow") flowToDomain.set(e.target, e.source);
    else if (e.type === "flow_step") stepToFlow.set(e.target, e.source);
  }
  const mentions = (n: GraphNode) =>
    (n.name ?? "").toLowerCase().includes(ent) ||
    (n.summary ?? "").toLowerCase().includes(ent);

  for (const n of graph.nodes) {
    if (n.type === "flow") {
      const dom = flowToDomain.get(n.id);
      if ((dom && domainOwns.has(dom)) || mentions(n)) touched.add(n.id);
    } else if (n.type === "step") {
      const flow = stepToFlow.get(n.id);
      const dom = flow ? flowToDomain.get(flow) : undefined;
      if ((dom && domainOwns.has(dom)) || mentions(n)) touched.add(n.id);
    }
  }
  return touched;
}

/** All distinct entities across every domain (items 114/118), sorted. */
export function allDomainEntities(graph: KnowledgeGraph): string[] {
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type !== "domain") continue;
    for (const e of (n.domainMeta?.entities ?? []) as string[]) {
      const t = e.trim();
      if (t) seen.add(t);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export interface EntityOwnership {
  entity: string;
  /** Domains listing this entity, by id + name. */
  domains: { id: string; name: string }[];
}
/**
 * Item 118: glossary — for each entity, which domains own/share it (case-
 * insensitive grouping; original casing kept from the first occurrence).
 */
export function entityGlossary(graph: KnowledgeGraph): EntityOwnership[] {
  const byKey = new Map<
    string,
    { entity: string; domains: { id: string; name: string }[] }
  >();
  for (const n of graph.nodes) {
    if (n.type !== "domain") continue;
    for (const raw of (n.domainMeta?.entities ?? []) as string[]) {
      const t = raw.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      let rec = byKey.get(key);
      if (!rec) {
        rec = { entity: t, domains: [] };
        byKey.set(key, rec);
      }
      if (!rec.domains.some((d) => d.id === n.id))
        rec.domains.push({ id: n.id, name: n.name });
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.entity.localeCompare(b.entity),
  );
}

/** Canonical entry-type buckets (item 117). */
export const ENTRY_TYPES = ["http", "cli", "event", "cron"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Normalise a flow's raw entryType into one of the canonical buckets. */
export function normalizeEntryType(raw: unknown): EntryType | "other" {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return "other";
  if (/(http|rest|api|web|route|endpoint)/.test(s)) return "http";
  if (/(cli|command|cmd|terminal)/.test(s)) return "cli";
  if (/(event|queue|message|subscribe|pubsub|kafka|topic)/.test(s))
    return "event";
  if (/(cron|schedule|timer|job|periodic)/.test(s)) return "cron";
  return "other";
}

/** Color per entry-type bucket (item 117 legend). */
export const ENTRY_TYPE_COLOR: Record<EntryType | "other", string> = {
  http: "#5b9bd5",
  cli: "#c9a05b",
  event: "#9b6bd5",
  cron: "#5bc9a0",
  other: "var(--color-text-muted)",
};

/**
 * Item 117: map each flow id → its normalised entry-type. Reads
 * domainMeta.entryType off flow nodes.
 */
export function flowEntryTypes(
  graph: KnowledgeGraph,
): Map<string, EntryType | "other"> {
  const m = new Map<string, EntryType | "other">();
  for (const n of graph.nodes) {
    if (n.type !== "flow") continue;
    m.set(n.id, normalizeEntryType(n.domainMeta?.entryType));
  }
  return m;
}

/** Distinct entry-types present across all flows (for the legend), ordered. */
export function presentEntryTypes(
  graph: KnowledgeGraph,
): (EntryType | "other")[] {
  const present = new Set<EntryType | "other">();
  for (const v of flowEntryTypes(graph).values()) present.add(v);
  const ordered: (EntryType | "other")[] = [...ENTRY_TYPES, "other"];
  return ordered.filter((t) => present.has(t));
}

/**
 * Item 188: the set of domain-graph node ids reachable within the current
 * subgraph. For an active domain: the domain + its flows + their steps. For
 * the overview (no active domain): all domains. Used to scope domain search.
 */
export function domainSubgraphNodeIds(
  graph: KnowledgeGraph,
  activeDomainId: string | null,
): Set<string> {
  const ids = new Set<string>();
  if (!activeDomainId) {
    for (const n of graph.nodes) if (n.type === "domain") ids.add(n.id);
    return ids;
  }
  ids.add(activeDomainId);
  const flows = flowsForDomain(graph, activeDomainId);
  for (const { flow, steps } of flows) {
    ids.add(flow.id);
    for (const s of steps) ids.add(s.node.id);
  }
  return ids;
}

export interface DomainCoverage {
  /** Distinct file paths claimed by some domain step. */
  mappedFiles: Set<string>;
  /** Total structural file count. */
  totalFiles: number;
  /** mappedFiles ∩ structural files. */
  coveredCount: number;
  /** Structural files not claimed by any domain step. */
  unmappedFiles: string[];
  /** Percentage 0–100. */
  percent: number;
}

/**
 * Feature 123: % of structural files claimed by some domain step's filePath.
 * `structuralFilePaths` is the set of file paths from the structural graph.
 */
export function computeDomainCoverage(
  domainGraph: KnowledgeGraph | null,
  structuralFilePaths: string[],
): DomainCoverage {
  const mappedFiles = new Set<string>();
  if (domainGraph) {
    for (const n of domainGraph.nodes) {
      if (n.type === "step" && n.filePath) mappedFiles.add(n.filePath);
    }
  }
  const total = structuralFilePaths.length;
  const structSet = new Set(structuralFilePaths);
  let covered = 0;
  const unmapped: string[] = [];
  for (const fp of structSet) {
    if (mappedFiles.has(fp)) covered += 1;
    else unmapped.push(fp);
  }
  return {
    mappedFiles,
    totalFiles: total,
    coveredCount: covered,
    unmappedFiles: unmapped.sort(),
    percent: total > 0 ? Math.round((covered / total) * 1000) / 10 : 0,
  };
}

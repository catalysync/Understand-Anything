// Shared derivations for the 200-series teaching curriculum (items 154/155/157).
//
//   • buildCurriculum  — an ordered "course" of modules from the graph's layers,
//     ranked foundations → core → features → infra, each listing its key nodes
//     by fan-in (item 154).
//   • buildPrerequisiteOrder — a topological "learn in this order" ranking over
//     imports/calls edges, foundational (deep inbound-dependency) nodes first
//     (item 155).
//   • CurriculumTrack filtering — preset role tracks scope the curriculum + graph
//     to relevant layers / node-types (item 157).
//
// Pure functions over the KnowledgeGraph so both CurriculumPanel and
// PrerequisitePanel can reuse them without duplicating graph math.

import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  Layer,
} from "@understand-anything/core/types";
import type { CurriculumTrack } from "./learningPersist";

// ---------------------------------------------------------------------------
// Fan-in ranking (shared)
// ---------------------------------------------------------------------------

/** Build inbound-degree (fan-in) over imports/calls/contains-free dependency edges. */
export function buildFanIn(graph: KnowledgeGraph): Map<string, number> {
  const fanIn = new Map<string, number>();
  for (const e of graph.edges) {
    if (!DEP_EDGE_TYPES.has(e.type)) continue;
    fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
  }
  return fanIn;
}

/** Edge types that express a "depends on" relationship for ordering. */
const DEP_EDGE_TYPES = new Set<GraphEdge["type"]>([
  "imports",
  "calls",
  "implements",
  "inherits",
  "subscribes",
  "publishes",
  "middleware",
]);

// ---------------------------------------------------------------------------
// Curriculum modules (item 154)
// ---------------------------------------------------------------------------

export type ModulePhase = "foundations" | "core" | "features" | "infra";

export interface CurriculumNodeRef {
  id: string;
  name: string;
  type: string;
  fanIn: number;
}

export interface CurriculumModule {
  id: string;
  layerId: string;
  title: string;
  description: string;
  phase: ModulePhase;
  /** Key nodes in this module, fan-in ranked (top N). */
  nodes: CurriculumNodeRef[];
  /** Total nodes in the underlying layer (for "N more"). */
  totalNodes: number;
}

/** Heuristic phase classification from a layer's name/description. */
function classifyPhase(layer: Layer): ModulePhase {
  const hay = `${layer.name} ${layer.description}`.toLowerCase();
  if (
    /\b(infra|infrastructure|deploy|build|ci|cd|config|ops|devops|docker|kubernetes|platform|tooling)\b/.test(
      hay,
    )
  )
    return "infra";
  if (
    /\b(foundation|core|domain|model|entity|type|schema|shared|util|base|common|store|state)\b/.test(
      hay,
    )
  )
    return "foundations";
  if (
    /\b(api|service|controller|handler|endpoint|route|engine|orchestrat|business|logic)\b/.test(
      hay,
    )
  )
    return "core";
  return "features";
}

const PHASE_ORDER: Record<ModulePhase, number> = {
  foundations: 0,
  core: 1,
  features: 2,
  infra: 3,
};

const PHASE_LABEL: Record<ModulePhase, string> = {
  foundations: "Foundations",
  core: "Core",
  features: "Features",
  infra: "Infrastructure",
};

export function phaseLabel(phase: ModulePhase): string {
  return PHASE_LABEL[phase];
}

export function buildCurriculum(
  graph: KnowledgeGraph,
  opts: { track?: CurriculumTrack; topNodesPerModule?: number } = {},
): CurriculumModule[] {
  const { track = "all", topNodesPerModule = 5 } = opts;
  const fanIn = buildFanIn(graph);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const typeFilter = trackTypeFilter(track);

  const modules: CurriculumModule[] = [];
  for (const layer of graph.layers) {
    const layerNodes: GraphNode[] = [];
    for (const nid of layer.nodeIds) {
      const n = nodesById.get(nid);
      if (n) layerNodes.push(n);
    }
    if (layerNodes.length === 0) continue;

    // Track-scoped: keep only relevant node-types when a role track is active.
    const relevant = typeFilter
      ? layerNodes.filter((n) => typeFilter(n))
      : layerNodes;
    if (relevant.length === 0) continue;

    const ranked = [...relevant]
      .sort((a, b) => (fanIn.get(b.id) ?? 0) - (fanIn.get(a.id) ?? 0))
      .slice(0, topNodesPerModule)
      .map<CurriculumNodeRef>((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        fanIn: fanIn.get(n.id) ?? 0,
      }));

    modules.push({
      id: `module:${layer.id}`,
      layerId: layer.id,
      title: layer.name,
      description: layer.description,
      phase: classifyPhase(layer),
      nodes: ranked,
      totalNodes: relevant.length,
    });
  }

  // Order by phase, then by total fan-in of the module's top nodes (heaviest first).
  return modules.sort((a, b) => {
    const p = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
    if (p !== 0) return p;
    const fa = a.nodes.reduce((s, n) => s + n.fanIn, 0);
    const fb = b.nodes.reduce((s, n) => s + n.fanIn, 0);
    return fb - fa;
  });
}

// ---------------------------------------------------------------------------
// Prerequisite order (item 155)
// ---------------------------------------------------------------------------

export interface PrereqNode {
  id: string;
  name: string;
  type: string;
  /** 0 = foundational (nothing it depends on); higher = depends on deeper things. */
  depth: number;
  fanIn: number;
}

/**
 * Rank nodes by inbound-dependency depth: a topological-ish ordering over
 * imports/calls so foundational nodes (depended on by many, depending on few)
 * come first. We compute the longest dependency chain depth via memoized DFS,
 * guarding against cycles.
 */
export function buildPrerequisiteOrder(
  graph: KnowledgeGraph,
  opts: { track?: CurriculumTrack; limit?: number } = {},
): PrereqNode[] {
  const { track = "all", limit = 40 } = opts;
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const typeFilter = trackTypeFilter(track);

  // depsOf: node → the things it depends on (forward edges).
  const depsOf = new Map<string, Set<string>>();
  const fanIn = new Map<string, number>();
  for (const e of graph.edges) {
    if (!DEP_EDGE_TYPES.has(e.type)) continue;
    if (!nodesById.has(e.source) || !nodesById.has(e.target)) continue;
    let s = depsOf.get(e.source);
    if (!s) {
      s = new Set();
      depsOf.set(e.source, s);
    }
    s.add(e.target);
    fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
  }

  const depthMemo = new Map<string, number>();
  const computeDepth = (id: string, stack: Set<string>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (stack.has(id)) return 0; // cycle guard
    const deps = depsOf.get(id);
    if (!deps || deps.size === 0) {
      depthMemo.set(id, 0);
      return 0;
    }
    stack.add(id);
    let max = 0;
    for (const d of deps) {
      max = Math.max(max, 1 + computeDepth(d, stack));
    }
    stack.delete(id);
    depthMemo.set(id, max);
    return max;
  };

  const candidates = graph.nodes.filter((n) => {
    // Only nodes that participate in dependency edges are interesting to order.
    const hasEdge = depsOf.has(n.id) || fanIn.has(n.id);
    if (!hasEdge) return false;
    if (typeFilter && !typeFilter(n)) return false;
    return true;
  });

  const ranked = candidates
    .map<PrereqNode>((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      depth: computeDepth(n.id, new Set()),
      fanIn: fanIn.get(n.id) ?? 0,
    }))
    // Foundational first: shallow depth, high fan-in.
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.fanIn - a.fanIn;
    });

  return ranked.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Role-based track filtering (item 157)
// ---------------------------------------------------------------------------

export const TRACK_LABELS: Record<CurriculumTrack, string> = {
  all: "Everything",
  frontend: "Frontend",
  backend: "Backend",
  data: "Data",
  devops: "DevOps",
  pm: "Product",
};

export const TRACK_HINTS: Record<CurriculumTrack, string> = {
  all: "The whole codebase, foundations first.",
  frontend: "UI, components, views & client state.",
  backend: "Endpoints, services & business logic.",
  data: "Tables, queries, models & schemas.",
  devops: "Config, infra, deploy & tooling.",
  pm: "Business domains & flows, no plumbing.",
};

export const ALL_TRACKS: CurriculumTrack[] = [
  "all",
  "frontend",
  "backend",
  "data",
  "devops",
  "pm",
];

/**
 * A predicate keeping only node-types relevant to a track, or null for "all".
 * Matches on node.type and, as a fallback, on name/tag keywords so it works
 * across the many analyzer node-type vocabularies.
 */
export function trackTypeFilter(
  track: CurriculumTrack,
): ((n: GraphNode) => boolean) | null {
  if (track === "all") return null;

  const typeSets: Record<Exclude<CurriculumTrack, "all">, Set<string>> = {
    frontend: new Set([
      "component",
      "page",
      "view",
      "ui",
      "hook",
      "store",
      "style",
    ]),
    backend: new Set([
      "endpoint",
      "route",
      "service",
      "controller",
      "handler",
      "function",
      "middleware",
      "class",
    ]),
    data: new Set([
      "table",
      "query",
      "model",
      "schema",
      "entity",
      "migration",
      "type",
      "enum",
      "data",
    ]),
    devops: new Set([
      "config",
      "service",
      "resource",
      "stage",
      "target",
      "infra",
      "deployment",
      "container",
    ]),
    pm: new Set(["domain", "flow", "step", "concept", "entity"]),
  };

  const keywordSets: Record<Exclude<CurriculumTrack, "all">, RegExp> = {
    frontend: /\b(component|view|page|ui|render|css|style|button|panel|modal)\b/i,
    backend: /\b(endpoint|route|service|controller|handler|api|server|auth|request)\b/i,
    data: /\b(table|query|model|schema|sql|migration|repository|dao|entity|column)\b/i,
    devops: /\b(config|deploy|docker|kube|ci|cd|pipeline|infra|terraform|helm|env)\b/i,
    pm: /\b(domain|flow|business|workflow|process|feature|user|customer)\b/i,
  };

  const types = typeSets[track];
  const kw = keywordSets[track];
  return (n: GraphNode) => {
    if (types.has(n.type)) return true;
    const tags = n.tags ?? [];
    if (tags.some((tg) => types.has(tg.toLowerCase()))) return true;
    return kw.test(n.name) || kw.test(n.summary ?? "");
  };
}

import { create } from "zustand";
import { SearchEngine } from "@understand-anything/core/search";
import type { SearchResult } from "@understand-anything/core/search";
import type { GraphIssue } from "@understand-anything/core/schema";
import type {
  GraphNode,
  KnowledgeGraph,
  TourStep,
} from "@understand-anything/core/types";
import type { ReactFlowInstance } from "@xyflow/react";
import type { ColorDimension } from "./components/traceColor";
import {
  type OnboardingGoal,
  type LearningState,
  type CurriculumTrack,
  EMPTY_LEARNING,
  loadLearning,
  saveLearning,
} from "./utils/learningPersist";
import {
  type FlashcardReviews,
  type VisitSnapshot,
  gradeCard,
  loadFlashcardReviews,
  saveFlashcardReviews,
  loadVisitSnapshot,
  saveVisitSnapshot,
} from "./utils/teachPersist";
import {
  type AppSettings,
  type DestinationsState,
  type PinnedEntity,
  type RecentEntity,
  DEFAULT_SETTINGS,
  EMPTY_DESTINATIONS,
  loadSettings,
  saveSettings,
  loadDestinations,
  saveDestinations,
  pushRecent,
  togglePinned as togglePinnedDest,
} from "./utils/settingsPersist";
import {
  type BoundaryRule,
  deriveDefaultRules,
} from "./utils/archLayer";
import {
  type LayerOverrideMap,
  loadLayerOverrides,
  saveLayerOverrides,
} from "./utils/layerOverrides";
import {
  type SearchHistory,
  EMPTY_SEARCH_HISTORY,
  loadSearchHistory,
  saveSearchHistory,
  pushRecentSearch,
  toggleStarredSearch as toggleStarredHist,
} from "./utils/searchHistory";
import {
  type PinnedPositions,
  loadPinnedPositions,
  savePinnedPositions,
} from "./utils/pinnedPositions";
import { parseScopes, compilePattern, regexSearch, nodeMatchesScope } from "./utils/searchScope";
import type { FilterPresetId } from "./utils/filterPresets";

export type { OnboardingGoal };
export type { LayerOverrideMap };
export type { AppSettings, RecentEntity, PinnedEntity };
export type { BoundaryRule };
export type { FilterPresetId };

/** Search mode: fuzzy (Fuse), semantic (alias), or regex/glob (200-65). */
export type SearchMode = "fuzzy" | "semantic" | "regex";

// ── Architecture boundary rules (300-series item 26) ───────────────────────
// Persisted per-project to localStorage (outside the workspace whitelist).
const ARCH_RULES_KEY_PREFIX = "ua-arch-rules-v1:";
function archRulesKey(projectKey: string): string {
  return `${ARCH_RULES_KEY_PREFIX}${projectKey || "default"}`;
}
function loadArchRules(projectKey: string): BoundaryRule[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(archRulesKey(projectKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BoundaryRule[];
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return null;
}
function saveArchRules(projectKey: string, rules: BoundaryRule[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(archRulesKey(projectKey), JSON.stringify(rules));
  } catch { /* ignore */ }
}

/**
 * Item 190: a structural node id resolved (via shared filePath) to the domain
 * step that covers it, plus the flow + domain it belongs to. Mirrors
 * nodeIdToLayerId — built once when the domain graph loads — so any trace hop /
 * structural node can show a "part of: <flow>" chip linking into the domain.
 */
export interface DomainStepRef {
  stepId: string;
  stepName: string;
  flowId: string;
  flowName: string;
  domainId: string;
  domainName: string;
}

export type Persona = "non-technical" | "junior" | "experienced";

/** Item 172: the diff between the current graph and the last-visit snapshot. */
export interface VisitRecap {
  /** First-ever visit — no prior snapshot existed (suppresses the card). */
  firstVisit: boolean;
  /** Node ids present now but absent at last visit. */
  addedNodeIds: string[];
  /** Node ids present at last visit but gone now. */
  removedNodeIds: string[];
  /** Node ids whose attrs.lastCommitAt changed since last visit. */
  changedNodeIds: string[];
  /** Layer name → count of added/changed nodes in it (for the headline). */
  layerCounts: { layerName: string; count: number }[];
  /** A stable signature of this recap (used to remember dismissal). */
  signature: string;
  /** When the previous snapshot was taken (epoch ms), 0 if none. */
  lastVisitAt: number;
}
/** Wave-4 feature 37b: answer-detail level for claude -p explanations. */
export type TraceLevel = "beginner" | "intermediate" | "expert";
/** Wave-4 feature 39: an @-mention context chip (a hop or file) Claude can see. */
export interface ContextChip {
  id: string;
  /** Human label shown on the chip, e.g. `executeDeploy` or `deploy.go`. */
  label: string;
  /** Relative file path used to fetch the source the model sees. */
  filePath: string;
  /** 1-based inclusive line range; null = whole file (header only). */
  lineRange: [number, number] | null;
  /** The exact source text the model will see (fetched when the chip is added). */
  source?: string;
}
export type NavigationLevel = "overview" | "layer-detail";
export type NodeType = "file" | "function" | "class" | "module" | "concept" | "config" | "document" | "service" | "table" | "endpoint" | "pipeline" | "schema" | "resource" | "domain" | "flow" | "step" | "article" | "entity" | "topic" | "claim" | "source"
  // Operations layer (300-series): entrypoints, tests, data, errors, observability, ownership, config
  | "route" | "command" | "event" | "schedule" | "api"
  | "test" | "suite" | "fixture" | "finding"
  | "column" | "model" | "query" | "transaction" | "migration"
  | "env_var" | "feature_flag" | "secret" | "cache_key"
  | "error_type"
  | "log_site" | "span_site" | "metric" | "alert"
  | "owner" | "doc" | "payload_schema";
export type Complexity = "simple" | "moderate" | "complex";
export type EdgeCategory = "structural" | "behavioral" | "data-flow" | "dependencies" | "semantic" | "infrastructure" | "domain" | "knowledge"
  // Operations layer (300-series)
  | "entrypoint" | "test" | "data-ops" | "error" | "observability" | "ownership" | "config";
export type ViewMode = "structural" | "domain" | "knowledge" | "trace" | "data";
export type DetailLevel = "file" | "class";

/** Structural-view layout engine: ELK layered (hierarchical) vs d3-force. */
export type StructuralLayout = "layered" | "force";
/** ELK primary direction for the layered structural layout. */
export type StructuralDirection = "DOWN" | "RIGHT";

const STRUCT_LAYOUT_KEY = "ua-structural-layout-v1";
const STRUCT_DIRECTION_KEY = "ua-structural-direction-v1";

function readPersisted<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch { /* ignore */ }
  return fallback;
}

function persist(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

/** Numeric rank for a complexity value — drives the complexity range slider (70/71/83). */
export const COMPLEXITY_RANK: Record<Complexity, number> = { simple: 0, moderate: 1, complex: 2 };

export interface FilterState {
  nodeTypes: Set<NodeType>;
  complexities: Set<Complexity>;
  layerIds: Set<string>;
  edgeCategories: Set<EdgeCategory>;
}

export const ALL_NODE_TYPES: NodeType[] = ["file", "function", "class", "module", "concept", "config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource", "domain", "flow", "step", "article", "entity", "topic", "claim", "source",
  // Operations layer (300-series)
  "route", "command", "event", "schedule", "api",
  "test", "suite", "fixture", "finding",
  "column", "model", "query", "transaction", "migration",
  "env_var", "feature_flag", "secret", "cache_key",
  "error_type",
  "log_site", "span_site", "metric", "alert",
  "owner", "doc", "payload_schema"];
export const ALL_COMPLEXITIES: Complexity[] = ["simple", "moderate", "complex"];
export const ALL_EDGE_CATEGORIES: EdgeCategory[] = ["structural", "behavioral", "data-flow", "dependencies", "semantic", "infrastructure", "domain", "knowledge",
  "entrypoint", "test", "data-ops", "error", "observability", "ownership", "config"];

export const EDGE_CATEGORY_MAP: Record<EdgeCategory, string[]> = {
  structural: ["imports", "exports", "contains", "inherits", "implements"],
  behavioral: ["calls", "subscribes", "publishes", "middleware"],
  "data-flow": ["reads_from", "writes_to", "transforms", "validates"],
  dependencies: ["depends_on", "tested_by", "configures"],
  semantic: ["related", "similar_to"],
  infrastructure: ["deploys", "serves", "provisions", "triggers", "migrates", "documents", "routes", "defines_schema"],
  domain: ["contains_flow", "flow_step", "cross_domain"],
  knowledge: ["cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by"],
  // Operations layer (300-series) — entrypoints, tests, data, errors, observability, ownership, config
  entrypoint: ["handles_route", "exposes_api", "provides_api", "consumes_api", "emits_event", "consumes_event", "triggered_by", "subcommand_of", "reachable_from", "passes_through", "short_circuits", "publishes_to", "subscribes_to"],
  test: ["covers", "asserts_on", "uses_fixture", "temporal_coupling", "duplicates", "flags_vuln", "killed_by"],
  "data-ops": ["foreign_key", "inferred_fk", "maps_to_table", "has_column", "has_association", "queries_table", "reads_table", "writes_table", "used_by", "runs_in_loop", "opens_transaction", "derives_from"],
  error: ["raises", "handles", "wraps", "swallows", "recovers", "error_path"],
  observability: ["logs", "instruments", "enriches_span", "emits_metric", "alerts_on"],
  ownership: ["owns", "owned_by", "part_of"],
  config: ["reads_config", "gated_by_flag", "secret_in_file", "caches", "reads_cache", "invalidates"],
};

export const DOMAIN_EDGE_TYPES = EDGE_CATEGORY_MAP.domain;

const DEFAULT_FILTERS: FilterState = {
  nodeTypes: new Set<NodeType>(ALL_NODE_TYPES),
  complexities: new Set<Complexity>(ALL_COMPLEXITIES),
  layerIds: new Set<string>(),
  edgeCategories: new Set<EdgeCategory>(ALL_EDGE_CATEGORIES),
};

/** Categories used for node type filter toggles. Single source of truth for NodeCategory. */
export type NodeCategory = "code" | "config" | "docs" | "infra" | "data" | "domain" | "knowledge";

/**
 * Build the (id → node) and (id → layerId) lookup maps that the rest of
 * the dashboard reads via store selectors. Centralised so `setGraph` and
 * any future graph-replacement path stay in sync.
 *
 * Two layer indexes, intentionally distinct:
 *
 * - `nodeIdToLayerId` preserves the prior `findNodeLayer` "first matching
 *   layer wins" semantics — if a node id appears in multiple layers
 *   (rare but legal in the schema), the first occurrence in `graph.layers`
 *   order is the one we map to. Drives navigation (drillIntoLayer, tour
 *   step → layer, sidebar history) where a single canonical layer is the
 *   right answer.
 *
 * - `nodeIdToLayerIds` records *every* layer a node belongs to. Drives
 *   membership queries (filterNodes) where the prior `Layer[] +
 *   layer.nodeIds.includes` shape was any-layer-wins — a node in L1 and
 *   L2 with only L2 selected must still pass. Collapsing to first-wins
 *   for filtering would be a silent regression.
 */
function buildGraphIndexes(graph: KnowledgeGraph): {
  nodesById: Map<string, GraphNode>;
  nodeIdToLayerId: Map<string, string>;
  nodeIdToLayerIds: Map<string, Set<string>>;
  filePathToNodeId: Map<string, string>;
} {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graph.nodes) nodesById.set(node.id, node);
  const nodeIdToLayerId = new Map<string, string>();
  const nodeIdToLayerIds = new Map<string, Set<string>>();
  for (const layer of graph.layers) {
    for (const nid of layer.nodeIds) {
      if (!nodeIdToLayerId.has(nid)) nodeIdToLayerId.set(nid, layer.id);
      let set = nodeIdToLayerIds.get(nid);
      if (!set) {
        set = new Set<string>();
        nodeIdToLayerIds.set(nid, set);
      }
      set.add(layer.id);
    }
  }
  // Domain features 110/105/123: map a source filePath → the structural node id
  // that owns it (prefer `file` nodes; fall back to first node with that path).
  // Mirrors nodeIdToLayerId: first-matching-wins, with `file` nodes preferred.
  const filePathToNodeId = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!node.filePath) continue;
    const existing = filePathToNodeId.get(node.filePath);
    if (!existing || node.type === "file") {
      // file node wins; otherwise keep first.
      if (!existing || node.type === "file") filePathToNodeId.set(node.filePath, node.id);
    }
  }
  return { nodesById, nodeIdToLayerId, nodeIdToLayerIds, filePathToNodeId };
}

/**
 * Item 190: build (structural node id → domain step) by joining the domain
 * graph's steps (which carry a filePath) to the structural graph via
 * filePathToNodeId. A structural node/trace hop in a file claimed by a domain
 * step gets a "part of: <flow>" reference. First-step-per-file wins.
 */
function buildNodeIdToDomainStep(
  domainGraph: KnowledgeGraph | null,
  filePathToNodeId: Map<string, string>,
): Map<string, DomainStepRef> {
  const index = new Map<string, DomainStepRef>();
  if (!domainGraph) return index;

  const byId = new Map(domainGraph.nodes.map((n) => [n.id, n] as const));
  // step id → flow id (via flow_step), flow id → domain id (via contains_flow).
  const stepToFlow = new Map<string, string>();
  const flowToDomain = new Map<string, string>();
  for (const e of domainGraph.edges) {
    if (e.type === "flow_step") stepToFlow.set(e.target, e.source);
    else if (e.type === "contains_flow") flowToDomain.set(e.target, e.source);
  }

  for (const node of domainGraph.nodes) {
    if (node.type !== "step" || !node.filePath) continue;
    const structuralId = filePathToNodeId.get(node.filePath);
    if (!structuralId || index.has(structuralId)) continue;
    const flowId = stepToFlow.get(node.id);
    if (!flowId) continue;
    const domainId = flowToDomain.get(flowId);
    if (!domainId) continue;
    const flow = byId.get(flowId);
    const domain = byId.get(domainId);
    index.set(structuralId, {
      stepId: node.id,
      stepName: node.name,
      flowId,
      flowName: flow?.name ?? "flow",
      domainId,
      domainName: domain?.name ?? "domain",
    });
  }
  return index;
}

/** Maximum number of entries in the sidebar navigation history. */
const MAX_HISTORY = 50;

/** Project key used to namespace localStorage settings + destinations. */
let settingsProjectKey = "default";

// ---------------------------------------------------------------------------
// Workspace persistence (bookmarks, annotations, node→session map, watches,
// saved tours). File-based via /workspace.json. createdAt is stamped server-side.
// ---------------------------------------------------------------------------

export interface Bookmark {
  id: string;
  nodeId: string;
  label?: string;
  note?: string;
  createdAt?: string;
}
export interface Annotation {
  id: string;
  nodeId: string;
  lineRange: [number, number] | null;
  text: string;
  createdAt?: string;
}
export interface SavedTour {
  id: string;
  name: string;
  hopIds: string[];
  createdAt?: string;
}
export interface Workspace {
  version: number;
  bookmarks: Bookmark[];
  annotations: Annotation[];
  sessions: Record<string, string>;
  watches: string[];
  tours: SavedTour[];
  /** Wave-4 feature 38: free-text "trace rules" sent as guidance on every
   *  claude -p call. Now whitelisted server-side so it persists. */
  rules: string;
}

export const EMPTY_WORKSPACE: Workspace = {
  version: 1,
  bookmarks: [],
  annotations: [],
  sessions: {},
  watches: [],
  tours: [],
  rules: "",
};

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let workspaceToken: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Project key used to namespace localStorage learning state. */
let learningProjectKey = "default";

/** Set the access token used for workspace GET/POST. Called once on load. */
export function setWorkspaceToken(token: string) {
  workspaceToken = token;
}

/** Debounced POST of the whole workspace object to /workspace.json. */
function schedulePersist(workspace: Workspace) {
  if (!workspaceToken || workspaceToken === "__demo__") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void fetch(`/workspace.json?token=${encodeURIComponent(workspaceToken!)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspace),
    }).catch(() => {});
  }, 500);
}

interface DashboardStore {
  graph: KnowledgeGraph | null;
  /** id → node lookup, rebuilt by setGraph. Empty before any graph loads. */
  nodesById: Map<string, GraphNode>;
  /** id → layer id (first-matching-layer wins), rebuilt by setGraph. Empty before any graph loads. */
  nodeIdToLayerId: Map<string, string>;
  /** id → set of every layer the node belongs to, rebuilt by setGraph. Empty before any graph loads. */
  nodeIdToLayerIds: Map<string, Set<string>>;
  /** Domain features 110/105/123: source filePath → structural node id (file-node preferred). */
  filePathToNodeId: Map<string, string>;
  /** Item 190: structural node id → the domain step covering it (built when the domain graph loads). */
  nodeIdToDomainStep: Map<string, DomainStepRef>;
  selectedNodeId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchEngine: SearchEngine | null;
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;

  // ── Search result cycling (200-series item 67) ─────────────────────────────
  /** Index into searchResults of the currently-cycled match (-1 = none). */
  searchCycleIndex: number;
  /** Step to the next (dir=1) / prev (dir=-1) match, focusing + panning to it. */
  cycleSearchResult: (dir: 1 | -1) => void;

  // ── Recent + starred searches (200-series item 69) ─────────────────────────
  searchHistory: SearchHistory;
  /** Commit the current query to the recents MRU (called on submit/blur). */
  commitRecentSearch: (query: string) => void;
  /** Star / unstar a query. */
  toggleStarredSearch: (query: string) => void;

  // ── Pinned / frozen node positions (200-series item 50) ────────────────────
  /** nodeId → fixed layout coord; honoured by the ELK/force layout passes. */
  pinnedPositions: PinnedPositions;
  /** Pin a node at a layout coordinate (drag-drop or lock toggle). */
  pinNodePosition: (nodeId: string, pos: { x: number; y: number }) => void;
  /** Remove a node's pin so it flows freely on the next re-layout. */
  unpinNodePosition: (nodeId: string) => void;
  /** Toggle a node's pin; when pinning without a coord, the caller passes one. */
  toggleNodePin: (nodeId: string, pos?: { x: number; y: number }) => void;
  isNodePinned: (nodeId: string) => boolean;
  clearPinnedPositions: () => void;

  // Lens navigation
  navigationLevel: NavigationLevel;
  activeLayerId: string | null;

  codeViewerOpen: boolean;
  codeViewerNodeId: string | null;
  codeViewerExpanded: boolean;

  tourActive: boolean;
  currentTourStep: number;
  tourHighlightedNodeIds: string[];

  persona: Persona;

  diffMode: boolean;
  changedNodeIds: Set<string>;
  affectedNodeIds: Set<string>;

  // Focus mode: isolate a node's 1-hop neighborhood
  focusNodeId: string | null;

  // Sidebar navigation history (stack of visited node IDs)
  nodeHistory: string[];

  // Filter & Export features
  filters: FilterState;
  filterPanelOpen: boolean;
  exportMenuOpen: boolean;
  pathFinderOpen: boolean;
  reactFlowInstance: ReactFlowInstance | null;

  // Node type category filters
  nodeTypeFilters: Record<NodeCategory, boolean>;
  toggleNodeTypeFilter: (category: NodeCategory) => void;

  // Detail level: "file" shows only file nodes (architecture view),
  // "class" shows files + class nodes (code structure view) with optional function expansion.
  detailLevel: DetailLevel;
  setDetailLevel: (level: DetailLevel) => void;
  showFunctionsInClassView: boolean;
  toggleShowFunctionsInClassView: () => void;

  // ---- Structural-view options (items 46/47/48/70/71/83) ---------------
  /** 46: layered (ELK hierarchical) vs force-directed layout. Persisted. */
  structuralLayout: StructuralLayout;
  setStructuralLayout: (layout: StructuralLayout) => void;
  /** 47: ELK primary direction DOWN (TB) vs RIGHT (LR). Persisted. */
  structuralDirection: StructuralDirection;
  toggleStructuralDirection: () => void;
  /** 48: hide low-degree leaf file nodes, surfaced as a +N badge on parent. */
  declutterLeaves: boolean;
  toggleDeclutterLeaves: () => void;
  /** 71: inclusive [minRank, maxRank] complexity window (0=simple..2=complex). */
  complexityRange: [number, number];
  setComplexityRange: (range: [number, number]) => void;
  /** 71: quick toggle — show only complex nodes (range [2,2]) vs all. */
  onlyComplex: boolean;
  toggleOnlyComplex: () => void;
  /** 70: multi-select tag facet. Empty = no tag constraint. */
  tagFilter: Set<string>;
  toggleTagFilter: (tag: string) => void;
  clearTagFilter: () => void;
  /** 83: recolor nodes green→amber→red by complexity. */
  complexityHeat: boolean;
  toggleComplexityHeat: () => void;

  // ── Connectivity / preset / staleness filters (200-series items 72/74/87) ──
  /** 72: minimum degree (incident edges) a node must have to stay visible. 0 = off. */
  minDegree: number;
  setMinDegree: (n: number) => void;
  /** 72: "hubs only" quick toggle — jumps minDegree to a hub threshold. */
  toggleHubsOnly: () => void;
  /** 74: active one-click filter preset (null = none). */
  activePreset: FilterPresetId | null;
  setActivePreset: (id: FilterPresetId | null) => void;
  /** 87: restrict the graph to recently-changed nodes (git lastCommitAt). */
  recentlyChangedOnly: boolean;
  toggleRecentlyChangedOnly: () => void;
  /** 87: subtle age-tint / dot on recently-changed nodes (persisted). */
  staleIndicators: boolean;
  toggleStaleIndicators: () => void;

  // ── Reachability / dead-code overlay (300-series items 12-14) ─────────────
  /** When set, BFS-highlight nodes reachable from this root; dim the rest. */
  reachabilityRootId: string | null;
  /** Dead-code mode: dim nodes reachable from NO entrypoint (union of all). */
  deadCodeOverlay: boolean;
  /** Set/clear the reachability root (also clears dead-code mode). */
  setReachabilityRoot: (id: string | null) => void;
  /** Toggle the dead-code overlay (also clears any single-root reachability). */
  toggleDeadCodeOverlay: () => void;
  /** Clear all reachability overlays. */
  clearReachabilityOverlay: () => void;

  // ── Tri-state coverage overlay (300-series items 39-45) ───────────────────
  /** Paint code nodes covered(green)/partial(yellow)/uncovered(red). Persisted. */
  coverageOverlay: boolean;
  toggleCoverageOverlay: () => void;
  /** Test-impact: when set, highlight the impacted-test closure of this node. */
  testImpactRootId: string | null;
  setTestImpactRoot: (id: string | null) => void;

  // ── Error-propagation overlay (300-series items 92-95) ────────────────────
  /** When set, highlight the static stack-trace propagation set for this error_type/code node. */
  errorPropRootId: string | null;
  setErrorPropRoot: (id: string | null) => void;
  /** Badge nodes that swallow errors (item 95). Persisted. */
  swallowedMarkers: boolean;
  toggleSwallowedMarkers: () => void;

  // ── Instrumentation-coverage heat overlay (300-series items 99/101-102) ───
  /** Paint code nodes instrumented(green)/auto-covered(amber)/telemetry-dark(red). Persisted. */
  instrumentationHeat: boolean;
  toggleInstrumentationHeat: () => void;

  // ── Data / ERD view (300-series items 61-64) ──────────────────────────────
  /** Attribute visibility level for the ERD. Persisted. */
  erdAttrLevel: "all" | "keys" | "names";
  setErdAttrLevel: (level: "all" | "keys" | "names") => void;

  // ── Git-metadata overlays (300-series items 27/48/51/108) ─────────────────
  /** Item 51: ownership overlay mode (off / owner-hue / single-owner-flag). Persisted. */
  ownershipOverlay: "off" | "owner" | "single-owner";
  setOwnershipOverlay: (mode: "off" | "owner" | "single-owner") => void;
  /** Item 51/118: when set, dim everything NOT owned by this owner ("show owner's code"). */
  ownerFilter: string | null;
  setOwnerFilter: (owner: string | null) => void;
  /** Item 27: highlight import-cycle nodes/edges in red. Persisted. */
  cyclesOverlay: boolean;
  toggleCyclesOverlay: () => void;
  /** Item 27: restrict the canvas to cycle-involved nodes only. */
  cyclesOnly: boolean;
  toggleCyclesOnly: () => void;
  /** Item 108: stamp resilience glyphs on calls edges to guarded callees. Persisted. */
  resilienceBadges: boolean;
  toggleResilienceBadges: () => void;
  /** Item 48: churn × complexity hotspot quadrant panel open. */
  hotspotPanelOpen: boolean;
  toggleHotspotPanel: () => void;
  setHotspotPanelOpen: (open: boolean) => void;

  // ── Architecture & API-surface tier (300-series items 9-10,21-22,25-26,28) ─
  /** Item 26: editable layer-import boundary rules (persisted per project). */
  archRules: BoundaryRule[];
  /** Whether default "no upward deps" rules have been seeded for the graph. */
  archRulesSeeded: boolean;
  /** Item 26: highlight violating import edges in red + open the panel. Persisted. */
  boundaryOverlay: boolean;
  toggleBoundaryOverlay: () => void;
  setArchRules: (rules: BoundaryRule[]) => void;
  toggleArchRule: (id: string) => void;
  addArchRule: (fromLayerId: string, toLayerId: string) => void;
  removeArchRule: (id: string) => void;
  resetArchRules: () => void;
  /** Item 21: "public surface only" filter — collapse internal code nodes. */
  publicSurfaceOnly: boolean;
  togglePublicSurfaceOnly: () => void;
  /** Item 25: C4 zoom level — System (overview) / Layer / File detail. */
  c4Level: "system" | "layer" | "file";
  setC4Level: (level: "system" | "layer" | "file") => void;
  /** Items 9-10/22/26: Architecture panel (event-bus / API surface / rules) open. */
  archPanelOpen: boolean;
  toggleArchPanel: () => void;
  setArchPanelOpen: (open: boolean) => void;

  // ── Visualization & structural-polish tier ────────────────────────────────
  /** 300-42: metric treemap panel open. */
  treemapPanelOpen: boolean;
  toggleTreemapPanel: () => void;
  setTreemapPanelOpen: (open: boolean) => void;
  /** 300-50: circle-packing "city" hotspot map panel open. */
  cityPanelOpen: boolean;
  toggleCityPanel: () => void;
  setCityPanelOpen: (open: boolean) => void;
  /** 200-81: cross-layer dependency matrix panel open. */
  matrixPanelOpen: boolean;
  toggleMatrixPanel: () => void;
  setMatrixPanelOpen: (open: boolean) => void;
  /** 200-156: reading-order ("read like a book") panel open. */
  readingPanelOpen: boolean;
  toggleReadingPanel: () => void;
  setReadingPanelOpen: (open: boolean) => void;
  /** 200-81: active matrix cell filter [rowLayerId, colLayerId] → graph shows only those edges' nodes. null = off. */
  matrixCellFilter: [string, string] | null;
  setMatrixCellFilter: (cell: [string, string] | null) => void;
  /** 200-79: per-layer color/name overrides (persisted per project). */
  layerOverrides: LayerOverrideMap;
  setLayerOverride: (layerId: string, patch: { color?: string; name?: string }) => void;
  resetLayerOverride: (layerId: string) => void;

  setGraph: (graph: KnowledgeGraph) => void;
  selectNode: (nodeId: string | null) => void;
  navigateToNode: (nodeId: string) => void;
  navigateToNodeInLayer: (nodeId: string) => void;
  navigateToHistoryIndex: (index: number) => void;
  goBackNode: () => void;
  drillIntoLayer: (layerId: string) => void;
  navigateToOverview: () => void;
  setFocusNode: (nodeId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setPersona: (persona: Persona) => void;
  openCodeViewer: (nodeId: string) => void;
  closeCodeViewer: () => void;
  expandCodeViewer: () => void;
  collapseCodeViewer: () => void;

  setDiffOverlay: (changed: string[], affected: string[]) => void;
  toggleDiffMode: () => void;
  clearDiffOverlay: () => void;

  toggleFilterPanel: () => void;
  toggleExportMenu: () => void;
  togglePathFinder: () => void;
  setReactFlowInstance: (instance: ReactFlowInstance | null) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  resetFilters: () => void;
  hasActiveFilters: () => boolean;

  startTour: () => void;
  /** Item 136: resume a previously-in-progress tour at the persisted step. */
  resumeTour: () => void;
  stopTour: () => void;
  setTourStep: (step: number) => void;
  nextTourStep: () => void;
  prevTourStep: () => void;

  // View mode
  viewMode: ViewMode;
  isKnowledgeGraph: boolean;
  domainGraph: KnowledgeGraph | null;
  activeDomainId: string | null;

  // ---- Domain business-flow UI state (features 91/93/99/113) -------------
  /** Feature 91: domain ids whose flows are expanded inline (accordion). */
  expandedDomainFlows: Set<string>;
  toggleDomainFlowsExpanded: (domainId: string) => void;
  /** Feature 93: focus-a-flow mode — isolate one flow + its steps; null = off. */
  focusedFlowId: string | null;
  setFocusedFlow: (flowId: string | null) => void;
  /** Feature 99: storyline mode — linearize the longest cross_domain chain. */
  domainStorylineMode: boolean;
  toggleDomainStoryline: () => void;
  /** Feature 113: domain search query (domains/flows/steps/entities by name/summary). */
  domainSearchQuery: string;
  setDomainSearchQuery: (q: string) => void;
  /** Feature 110/106: jump from a domain step to its source / a trace. */
  openStepFile: (stepNodeId: string) => void;
  traceStepCode: (stepNodeId: string) => void;

  // Flow / Trace view: walk a call chain starting from a root node.
  // traceRoot is the originally-selected node; traceStack is the breadcrumb
  // of descended node ids (always starts with [traceRoot]). The focus node
  // (the one whose call chain is rendered) is the last id in traceStack.
  traceRoot: string | null;
  traceStack: string[];
  setTraceRoot: (id: string) => void;
  pushTrace: (id: string) => void;
  popTrace: () => void;
  /** Truncate the trace breadcrumb to the first `length` entries (>=1). */
  truncateTrace: (length: number) => void;

  // ---- Wave-1 trace navigation UI state --------------------------------
  /** "callees" walks outgoing calls (default); "callers" walks incoming. */
  traceDirection: "callees" | "callers";
  setTraceDirection: (dir: "callees" | "callers") => void;
  /** Build depth for the trace (1–6). */
  traceDepth: number;
  setTraceDepth: (depth: number) => void;
  /** Layout for the trace body. */
  traceLayout: "nested" | "flat" | "shape";
  setTraceLayout: (layout: "nested" | "flat" | "shape") => void;
  /** Substring/glob patterns; hops whose name matches fold to a thin row. */
  traceFoldedPatterns: string[];
  addFoldPattern: (pattern: string) => void;
  removeFoldPattern: (pattern: string) => void;
  /** Per-hop manual unfold overrides (node ids forced visible). */
  traceUnfolded: Set<string>;
  toggleUnfold: (nodeId: string) => void;
  /** Packages that are muted (greyed + collapsed + excluded from explain). */
  traceMutedPackages: Set<string>;
  toggleMutedPackage: (pkg: string) => void;
  /** Whether default-mute seeding has run for the current graph. */
  traceMuteSeeded: boolean;
  seedMutedPackages: (pkgs: string[]) => void;
  /** Critical-path highlight toggle. */
  traceCriticalPath: boolean;
  toggleCriticalPath: () => void;
  /** "Path to…" target node id (path-between-two-nodes mode). */
  tracePathTarget: string | null;
  setPathTarget: (id: string | null) => void;
  /** Wave-5 feature 44: the "Color by:" dimension for hop rails/badges. */
  traceColorBy: ColorDimension;
  setTraceColorBy: (dim: ColorDimension) => void;

  // ---- Wave-3 interactive-debugging UI state ---------------------------
  /** Feature 26: conditional-highlight predicate string (empty = off). */
  tracePredicate: string;
  setPredicate: (p: string) => void;
  /** Feature 26: when true, hide non-matching hops instead of just ringing. */
  tracePredicateFilter: boolean;
  togglePredicateFilter: () => void;
  /** Feature 27: error-path highlight toggle. */
  traceErrorPath: boolean;
  toggleErrorPath: () => void;
  /** Feature 28: complexity heat overlay toggle. */
  traceHeat: boolean;
  toggleHeat: () => void;
  /** Feature 30: in-app trace snapshots (session-scoped; NOT persisted —
   *  the server workspace whitelist drops unknown keys). id → ordered hop ids. */
  traceSnapshots: { id: string; name: string; ids: string[]; createdAt: string }[];
  /** Feature 30: which snapshot is the active diff baseline (null = off). */
  traceDiffBaseline: string | null;
  snapshotTrace: (name: string, ids: string[]) => string;
  removeSnapshot: (id: string) => void;
  setDiffBaseline: (id: string | null) => void;

  /** Wave-2: fuzzy symbol palette (⌘K / ⌘P) open state. */
  symbolPaletteOpen: boolean;
  toggleSymbolPalette: () => void;
  setSymbolPaletteOpen: (open: boolean) => void;
  /** Wave-2: start a trace at a node from anywhere (palette / goto). */
  startTraceAt: (id: string) => void;

  // Workspace persistence
  workspace: Workspace;
  workspaceLoaded: boolean;
  bookmarksPanelOpen: boolean;
  toggleBookmarksPanel: () => void;
  loadWorkspace: (ws: Workspace) => void;
  toggleBookmark: (nodeId: string, label?: string) => void;
  isBookmarked: (nodeId: string) => boolean;
  addAnnotation: (nodeId: string, text: string, lineRange?: [number, number] | null) => void;
  removeAnnotation: (id: string) => void;
  setNodeSession: (nodeId: string, sessionId: string) => void;
  getNodeSession: (nodeId: string) => string | undefined;
  addWatch: (symbol: string) => void;
  removeWatch: (symbol: string) => void;
  saveTour: (name: string, hopIds: string[]) => void;
  removeTour: (id: string) => void;

  // ---- Onboarding / teaching state (items 131-165) ----------------------
  //
  // NOTE: all of this is persisted to localStorage (not workspace.json) — the
  // server whitelist drops unknown keys, so onboarding goal / tour progress /
  // coverage / checklist / language-axis live client-side, keyed per project.
  learning: LearningState;
  learningLoaded: boolean;
  /** Hydrate learning state for a project key (called once the graph loads). */
  loadLearning: (projectKey: string) => void;
  /** Item 132: route the initial view from the "Pick your goal" card. */
  setOnboardingGoal: (goal: OnboardingGoal | null) => void;
  /** Item 149: toggle the "New to Go?" language axis (separate from persona). */
  toggleLanguageAxis: () => void;
  /** Item 158: mark a node visited (selected / explained / traced). */
  markVisited: (nodeId: string) => void;
  /** Item 161: dismiss the onboarding checklist card. */
  dismissChecklist: () => void;
  /** Item 161: explicitly flag a checklist milestone (domain-flow read). */
  markChecklist: (key: "tookTour" | "didTrace" | "readDomainFlow") => void;

  // ---- 200-series teaching long-tail (items 154/157/163/172) ------------
  /** Item 154: toggle a curriculum module's completed state. */
  toggleModuleComplete: (moduleId: string) => void;
  /** Item 157: set the active role-based curriculum track. */
  setCurriculumTrack: (track: CurriculumTrack) => void;
  /** Item 163: flashcard spaced-review state (per project, localStorage). */
  flashcardReviews: FlashcardReviews;
  /** Item 163: grade a flashcard ("got it" = correct, "again" = wrong). */
  gradeFlashcard: (cardId: string, correct: boolean) => void;
  /** Item 172: the recap diff vs the last-visit snapshot (computed once on graph load). */
  visitRecap: VisitRecap | null;
  /** Item 172: dismiss the "what changed" recap card. */
  dismissRecap: () => void;

  // ---- Wave-4: converse-with-Claude state -------------------------------
  /** Feature 38: persisted free-text trace rules (workspace.rules). */
  setRules: (rules: string) => void;
  /** Feature 37b: answer-detail persona for claude -p (beginner/intermediate/expert). */
  traceLevel: TraceLevel;
  setTraceLevel: (level: TraceLevel) => void;
  /** Feature 40: ground answers in Go stdlib/spec. */
  goDocs: boolean;
  toggleGoDocs: () => void;
  /** Feature 39: @-mention context chips (hops/files added as extra context). */
  contextChips: ContextChip[];
  addContextChip: (chip: ContextChip) => void;
  removeContextChip: (id: string) => void;
  clearContextChips: () => void;

  setDomainGraph: (graph: KnowledgeGraph) => void;
  /**
   * K2: switch view mode. By default the focused node is CARRIED across views
   * (re-root trace / focus structural / expand domain) instead of being reset.
   * Pass `{ keepSelection: false }` for the legacy hard-reset behavior.
   */
  setViewMode: (mode: ViewMode, opts?: { keepSelection?: boolean }) => void;
  setIsKnowledgeGraph: (value: boolean) => void;
  navigateToDomain: (domainId: string) => void;
  clearActiveDomain: () => void;

  /**
   * K1: focus a single entity consistently across whatever the current (or a
   * given) view is. Sets the right per-view target so one call lands the user
   * on the node: trace → re-root, domain → select within domain, structural/
   * knowledge → select + layer-navigate. Keeps existing state intact.
   */
  focusEntity: (nodeId: string, opts?: { view?: ViewMode }) => void;

  // K3: shared node context menu. Anchored at viewport (x,y); null = closed.
  contextMenu: { nodeId: string; x: number; y: number } | null;
  openContextMenu: (nodeId: string, x: number, y: number) => void;
  closeContextMenu: () => void;

  // ---- Integration / app-wide-polish state (items 187/200b/200c) ----------
  /** Item 187: recently-focused entities + pinned destinations (palette header). */
  destinations: DestinationsState;
  /** Item 187: record a focused entity into recents (persisted to localStorage). */
  recordRecent: (nodeId: string) => void;
  /** Item 187: pin / unpin a destination. */
  togglePinnedDestination: (nodeId: string) => void;
  isPinnedDestination: (nodeId: string) => boolean;

  /** Item 200b: app-wide settings (default landing view + trace defaults). */
  settings: AppSettings;
  settingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;

  /** Item 200c: ARIA live-region message announcing view/selection changes. */
  ariaAnnouncement: string;
  announce: (message: string) => void;

  /**
   * Item 186: route a federated search result to its best view. `kind` is the
   * resolved RouteKind (trace/domain/structural/code); `domainId` is required
   * for domain routing of a flow/step (the domain to enter first).
   */
  openSearchResult: (
    nodeId: string,
    kind: "trace" | "domain" | "structural" | "code",
    domainId?: string,
  ) => void;

  // Container expand/collapse + lazy layout caches
  expandedContainers: Set<string>;
  toggleContainer: (containerId: string) => void;
  expandContainer: (containerId: string) => void;
  collapseContainer: (containerId: string) => void;
  collapseAllContainers: () => void;
  /** Item 25 (C4 File level): expand every container at once. */
  expandAllContainers: (containerIds: string[]) => void;
  /** Container the user just manually expanded; viewport should lock onto it. Cleared by GraphView once the lock is applied. */
  pendingFocusContainer: string | null;
  setPendingFocusContainer: (containerId: string | null) => void;
  /** True while TourFitView is waiting for highlighted nodes to materialise (Stage 2 layout in progress). Drives the "Computing layout…" overlay. */
  tourFitPending: boolean;
  setTourFitPending: (pending: boolean) => void;

  containerLayoutCache: Map<
    string,
    {
      childPositions: Map<string, { x: number; y: number }>;
      actualSize: { width: number; height: number };
    }
  >;
  setContainerLayout: (
    containerId: string,
    childPositions: Map<string, { x: number; y: number }>,
    actualSize: { width: number; height: number },
  ) => void;
  clearContainerLayouts: () => void;

  containerSizeMemory: Map<string, { width: number; height: number }>;

  stage1Tick: number;
  bumpStage1Tick: () => void;

  // Layout-time issues (e.g. ELK input repair). Funneled into the
  // WarningBanner alongside graph-validation issues.
  layoutIssues: GraphIssue[];
  appendLayoutIssues: (issues: GraphIssue[]) => void;
  clearLayoutIssues: () => void;
}

/**
 * Items 140/141/147: tour steps may optionally carry a per-step `view`
 * (structural / domain / trace), a `traceNodeId` (Trace-this target), and a
 * `personas` allow-list. These are NOT in the core TourStep type yet, so we
 * read them off an extended view at runtime (and fall back to heuristics).
 */
export interface ExtendedTourStep extends TourStep {
  view?: ViewMode;
  traceNodeId?: string;
  personas?: Persona[];
}

/** Item 140: which view a step wants. Defaults to structural when absent. */
export function tourStepView(step: TourStep): ViewMode {
  return (step as ExtendedTourStep).view ?? "structural";
}

/**
 * Item 147: persona-adapted tour depth. A step is shown when it either declares
 * the active persona in its `personas` list, or (heuristic, when no list is
 * given) when its depth fits the persona:
 *   - non-technical: only the first half of the tour + domain-flavoured steps
 *   - junior:        every step (full walkthrough)
 *   - experienced:   condensed — every other step after the first two
 */
export function tourStepVisibleForPersona(
  step: TourStep,
  index: number,
  total: number,
  persona: Persona,
): boolean {
  const declared = (step as ExtendedTourStep).personas;
  if (declared && declared.length > 0) return declared.includes(persona);
  if (persona === "junior") return true;
  if (persona === "non-technical") {
    const isDomain = tourStepView(step) === "domain";
    return isDomain || index < Math.ceil(total / 2);
  }
  // experienced — keep the first two, then every other step (condensed).
  return index < 2 || index % 2 === 0;
}

/** Item 137/136: persist the live tour position + completion into localStorage. */
function persistTourProgress(
  state: DashboardStore,
  step: number,
  inProgress: boolean,
): Partial<DashboardStore> {
  const completed = new Set(state.learning.completedSteps);
  // Mark every step up to (but not including) the current one as completed.
  for (let i = 0; i < step; i++) completed.add(i);
  const learning: LearningState = {
    ...state.learning,
    tourStep: step,
    tourInProgress: inProgress,
    completedSteps: Array.from(completed).sort((a, b) => a - b),
    tookTour: state.learning.tookTour || inProgress,
  };
  saveLearning(learningProjectKey, learning);
  return { learning };
}

function getSortedTour(graph: KnowledgeGraph): TourStep[] {
  const tour = graph.tour ?? [];
  return [...tour].sort((a, b) => a.order - b.order);
}

/** Navigate tour step to the correct layer for the first highlighted node. */
function navigateTourToLayer(
  nodeIdToLayerId: Map<string, string>,
  nodeIds: string[],
): Partial<DashboardStore> {
  if (nodeIds.length === 0) return {};
  const layerId = nodeIdToLayerId.get(nodeIds[0]);
  if (layerId) {
    return {
      navigationLevel: "layer-detail" as const,
      activeLayerId: layerId,
    };
  }
  return {};
}

/**
 * Container ids derive from per-layer state — folder names in folder-strategy
 * layers, community indices (`container:cluster-N`) in community-strategy
 * layers — and collide across layers (e.g. API Contracts and Load Testing
 * both produce `container:cluster-0`). When a tour step crosses layers we
 * must drop the previous layer's container caches so Stage 2 actually re-
 * runs for the new layer's children. Mirrors the reset block in
 * `drillIntoLayer`.
 */
function layerResetIfChanged(
  layerNav: Partial<DashboardStore>,
  prevLayerId: string | null,
): Partial<DashboardStore> {
  const next = layerNav.activeLayerId;
  if (!next || next === prevLayerId) return {};
  return {
    containerLayoutCache: new Map(),
    containerSizeMemory: new Map(),
    expandedContainers: new Set(),
    // Drop any pending focus too — its id was scoped to the previous
    // layer and would otherwise re-collide with a same-id container in
    // the new layer for the duration of the 1.2s timer.
    pendingFocusContainer: null,
  };
}

/** Item 172: snapshot the current graph's node-ids + last-commit timestamps. */
function snapshotGraph(graph: KnowledgeGraph): VisitSnapshot {
  const commitAt: Record<string, string> = {};
  for (const n of graph.nodes) {
    const ts = n.attrs?.lastCommitAt;
    if (typeof ts === "string") commitAt[n.id] = ts;
  }
  return {
    takenAt: Date.now(),
    nodeIds: graph.nodes.map((n) => n.id).sort(),
    commitAt,
  };
}

/**
 * Item 172: diff the current graph against the last-visit snapshot. Returns a
 * recap of added / removed / changed nodes, grouped by layer for the headline.
 * `firstVisit` is true when there was no prior snapshot (the caller suppresses
 * the card in that case).
 */
function computeVisitRecap(
  graph: KnowledgeGraph | null,
  prev: VisitSnapshot | null,
): VisitRecap | null {
  if (!graph) return null;
  if (!prev) {
    return {
      firstVisit: true,
      addedNodeIds: [],
      removedNodeIds: [],
      changedNodeIds: [],
      layerCounts: [],
      signature: "first",
      lastVisitAt: 0,
    };
  }
  const prevIds = new Set(prev.nodeIds);
  const curIds = new Set(graph.nodes.map((n) => n.id));
  const added: string[] = [];
  const changed: string[] = [];
  for (const n of graph.nodes) {
    if (!prevIds.has(n.id)) {
      added.push(n.id);
      continue;
    }
    const ts = n.attrs?.lastCommitAt;
    if (
      typeof ts === "string" &&
      prev.commitAt[n.id] &&
      prev.commitAt[n.id] !== ts
    ) {
      changed.push(n.id);
    }
  }
  const removed = prev.nodeIds.filter((id) => !curIds.has(id));

  // Group added + changed by layer for a friendly headline.
  const touched = new Set([...added, ...changed]);
  const layerCount = new Map<string, number>();
  for (const layer of graph.layers) {
    let c = 0;
    for (const nid of layer.nodeIds) if (touched.has(nid)) c++;
    if (c > 0) layerCount.set(layer.name, c);
  }
  const layerCounts = Array.from(layerCount.entries())
    .map(([layerName, count]) => ({ layerName, count }))
    .sort((a, b) => b.count - a.count);

  const signature = `${prev.takenAt}:${added.length}:${removed.length}:${changed.length}`;
  return {
    firstVisit: false,
    addedNodeIds: added,
    removedNodeIds: removed,
    changedNodeIds: changed,
    layerCounts,
    signature,
    lastVisitAt: prev.takenAt,
  };
}

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  graph: null,
  nodesById: new Map<string, GraphNode>(),
  nodeIdToLayerId: new Map<string, string>(),
  nodeIdToLayerIds: new Map<string, Set<string>>(),
  filePathToNodeId: new Map<string, string>(),
  nodeIdToDomainStep: new Map<string, DomainStepRef>(),
  selectedNodeId: null,
  searchQuery: "",
  searchResults: [],
  searchEngine: null,
  searchMode: readPersisted<SearchMode>("ua-search-mode-v1", ["fuzzy", "semantic", "regex"], "fuzzy"),
  searchCycleIndex: -1,
  searchHistory: { ...EMPTY_SEARCH_HISTORY },
  pinnedPositions: {},

  navigationLevel: "overview",
  activeLayerId: null,
  codeViewerOpen: false,
  codeViewerNodeId: null,
  codeViewerExpanded: false,

  tourActive: false,
  currentTourStep: 0,
  tourHighlightedNodeIds: [],

  persona: "junior",

  diffMode: false,
  changedNodeIds: new Set<string>(),
  affectedNodeIds: new Set<string>(),

  focusNodeId: null,
  nodeHistory: [],

  filters: { ...DEFAULT_FILTERS, nodeTypes: new Set(DEFAULT_FILTERS.nodeTypes), complexities: new Set(DEFAULT_FILTERS.complexities), layerIds: new Set(DEFAULT_FILTERS.layerIds), edgeCategories: new Set(DEFAULT_FILTERS.edgeCategories) },
  filterPanelOpen: false,
  exportMenuOpen: false,
  pathFinderOpen: false,
  reactFlowInstance: null,

  nodeTypeFilters: { code: true, config: true, docs: true, infra: true, data: true, domain: true, knowledge: true },

  toggleNodeTypeFilter: (category) =>
    set((state) => ({
      nodeTypeFilters: {
        ...state.nodeTypeFilters,
        [category]: !state.nodeTypeFilters[category],
      },
      // Filter changes shift container.nodeIds; cached child positions
      // may reference filtered-out children. Drop the cache so Stage 2
      // recomputes against the current set.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    })),

  detailLevel: "file",
  setDetailLevel: (level) =>
    set({
      detailLevel: level,
      // Detail level changes which nodes are visible; cached positions stale.
      // Reset fn toggle so it doesn't resurrect when re-entering class view.
      showFunctionsInClassView: false,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  showFunctionsInClassView: false,
  toggleShowFunctionsInClassView: () =>
    set((state) => ({
      showFunctionsInClassView: !state.showFunctionsInClassView,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    })),

  // ---- Structural-view options ----------------------------------------
  // Layout/direction changes alter every position, so drop the container
  // caches exactly like detailLevel/filter changes do.
  structuralLayout: readPersisted<StructuralLayout>(STRUCT_LAYOUT_KEY, ["layered", "force"], "layered"),
  setStructuralLayout: (layout) => {
    persist(STRUCT_LAYOUT_KEY, layout);
    set({
      structuralLayout: layout,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    });
  },
  structuralDirection: readPersisted<StructuralDirection>(STRUCT_DIRECTION_KEY, ["DOWN", "RIGHT"], "DOWN"),
  toggleStructuralDirection: () =>
    set((state) => {
      const next = state.structuralDirection === "DOWN" ? "RIGHT" : "DOWN";
      persist(STRUCT_DIRECTION_KEY, next);
      return {
        structuralDirection: next,
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  declutterLeaves: false,
  toggleDeclutterLeaves: () =>
    set((state) => ({
      declutterLeaves: !state.declutterLeaves,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    })),
  complexityRange: [0, 2],
  setComplexityRange: (range) =>
    set((state) => {
      const lo = Math.max(0, Math.min(2, Math.min(range[0], range[1])));
      const hi = Math.max(0, Math.min(2, Math.max(range[0], range[1])));
      if (lo === state.complexityRange[0] && hi === state.complexityRange[1]) return {};
      return {
        complexityRange: [lo, hi],
        onlyComplex: lo === 2 && hi === 2,
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  onlyComplex: false,
  toggleOnlyComplex: () =>
    set((state) => {
      const next = !state.onlyComplex;
      return {
        onlyComplex: next,
        complexityRange: next ? [2, 2] : [0, 2],
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  tagFilter: new Set<string>(),
  toggleTagFilter: (tag) =>
    set((state) => {
      const next = new Set(state.tagFilter);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return {
        tagFilter: next,
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  clearTagFilter: () =>
    set((state) =>
      state.tagFilter.size === 0
        ? {}
        : {
            tagFilter: new Set<string>(),
            containerLayoutCache: new Map(),
            containerSizeMemory: new Map(),
            expandedContainers: new Set(),
            pendingFocusContainer: null,
          },
    ),
  complexityHeat: false,
  toggleComplexityHeat: () => set((s) => ({ complexityHeat: !s.complexityHeat })),

  // ── Connectivity / preset / staleness filters (200-series 72/74/87) ────────
  minDegree: 0,
  setMinDegree: (n) =>
    set((s) => {
      const next = Math.max(0, Math.min(20, Math.round(n)));
      if (next === s.minDegree) return {};
      return {
        minDegree: next,
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  toggleHubsOnly: () =>
    set((s) => {
      // Hubs-only is "minDegree at the hub threshold (5)"; toggles back to 0.
      const next = s.minDegree >= 5 ? 0 : 5;
      return {
        minDegree: next,
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  activePreset: null,
  setActivePreset: (id) =>
    set((s) => {
      const next = s.activePreset === id ? null : id;
      return {
        activePreset: next,
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  recentlyChangedOnly: false,
  toggleRecentlyChangedOnly: () =>
    set((s) => ({
      recentlyChangedOnly: !s.recentlyChangedOnly,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    })),
  staleIndicators: readPersisted("ua-stale-indicators-v1", ["on", "off"], "off") === "on",
  toggleStaleIndicators: () =>
    set((s) => {
      const next = !s.staleIndicators;
      persist("ua-stale-indicators-v1", next ? "on" : "off");
      return { staleIndicators: next };
    }),

  // ── Reachability / dead-code overlay (300-series items 12-14) ─────────────
  reachabilityRootId: null,
  deadCodeOverlay: false,
  setReachabilityRoot: (id) => set({ reachabilityRootId: id, deadCodeOverlay: false }),
  toggleDeadCodeOverlay: () =>
    set((s) => ({ deadCodeOverlay: !s.deadCodeOverlay, reachabilityRootId: null })),
  clearReachabilityOverlay: () => set({ reachabilityRootId: null, deadCodeOverlay: false }),

  // ── Tri-state coverage overlay (300-series items 39-45) ───────────────────
  coverageOverlay: readPersisted("ua-coverage-overlay-v1", ["on", "off"], "off") === "on",
  toggleCoverageOverlay: () =>
    set((s) => {
      const next = !s.coverageOverlay;
      persist("ua-coverage-overlay-v1", next ? "on" : "off");
      return { coverageOverlay: next };
    }),
  testImpactRootId: null,
  setTestImpactRoot: (id) => set({ testImpactRootId: id }),

  // ── Error-propagation overlay (300-series items 92-95) ────────────────────
  errorPropRootId: null,
  setErrorPropRoot: (id) => set({ errorPropRootId: id }),
  swallowedMarkers: readPersisted("ua-swallowed-markers-v1", ["on", "off"], "on") === "on",
  toggleSwallowedMarkers: () =>
    set((s) => {
      const next = !s.swallowedMarkers;
      persist("ua-swallowed-markers-v1", next ? "on" : "off");
      return { swallowedMarkers: next };
    }),

  // ── Instrumentation-coverage heat overlay (300-series items 99/101-102) ───
  instrumentationHeat: readPersisted("ua-instrumentation-heat-v1", ["on", "off"], "off") === "on",
  toggleInstrumentationHeat: () =>
    set((s) => {
      const next = !s.instrumentationHeat;
      persist("ua-instrumentation-heat-v1", next ? "on" : "off");
      return { instrumentationHeat: next };
    }),

  // ── Data / ERD view (300-series items 61-64) ──────────────────────────────
  erdAttrLevel: readPersisted("ua-erd-attr-level-v1", ["all", "keys", "names"], "all"),
  setErdAttrLevel: (level) => {
    persist("ua-erd-attr-level-v1", level);
    set({ erdAttrLevel: level });
  },

  // ── Git-metadata overlays (300-series items 27/48/51/108) ─────────────────
  ownershipOverlay: readPersisted("ua-ownership-overlay-v1", ["off", "owner", "single-owner"], "off"),
  setOwnershipOverlay: (mode) => {
    persist("ua-ownership-overlay-v1", mode);
    set({ ownershipOverlay: mode });
  },
  ownerFilter: null,
  setOwnerFilter: (owner) => set({ ownerFilter: owner }),
  cyclesOverlay: readPersisted("ua-cycles-overlay-v1", ["on", "off"], "off") === "on",
  toggleCyclesOverlay: () =>
    set((s) => {
      const next = !s.cyclesOverlay;
      persist("ua-cycles-overlay-v1", next ? "on" : "off");
      // Turning the overlay off also exits cycles-only mode.
      return { cyclesOverlay: next, cyclesOnly: next ? s.cyclesOnly : false };
    }),
  cyclesOnly: false,
  toggleCyclesOnly: () =>
    set((s) => {
      const next = !s.cyclesOnly;
      // cycles-only implies the overlay is on (so the user sees the red highlight),
      // and changing the visible node set drops the container caches.
      return {
        cyclesOnly: next,
        cyclesOverlay: next ? true : s.cyclesOverlay,
        containerLayoutCache: new Map(),
        containerSizeMemory: new Map(),
        expandedContainers: new Set(),
        pendingFocusContainer: null,
      };
    }),
  resilienceBadges: readPersisted("ua-resilience-badges-v1", ["on", "off"], "on") === "on",
  toggleResilienceBadges: () =>
    set((s) => {
      const next = !s.resilienceBadges;
      persist("ua-resilience-badges-v1", next ? "on" : "off");
      return { resilienceBadges: next };
    }),
  hotspotPanelOpen: false,
  toggleHotspotPanel: () => set((s) => ({ hotspotPanelOpen: !s.hotspotPanelOpen })),
  setHotspotPanelOpen: (open) => set({ hotspotPanelOpen: open }),

  // ── Architecture & API-surface tier (300-series) ──────────────────────────
  archRules: [],
  archRulesSeeded: false,
  boundaryOverlay: readPersisted("ua-boundary-overlay-v1", ["on", "off"], "off") === "on",
  toggleBoundaryOverlay: () =>
    set((s) => {
      const next = !s.boundaryOverlay;
      persist("ua-boundary-overlay-v1", next ? "on" : "off");
      return { boundaryOverlay: next };
    }),
  setArchRules: (rules) => {
    saveArchRules(settingsProjectKey, rules);
    set({ archRules: rules });
  },
  toggleArchRule: (id) =>
    set((s) => {
      const rules = s.archRules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r,
      );
      saveArchRules(settingsProjectKey, rules);
      return { archRules: rules };
    }),
  addArchRule: (fromLayerId, toLayerId) =>
    set((s) => {
      const id = `user:${fromLayerId}->${toLayerId}`;
      if (s.archRules.some((r) => r.id === id)) return {};
      const rules = [
        ...s.archRules,
        { id, fromLayerId, toLayerId, enabled: true, derived: false },
      ];
      saveArchRules(settingsProjectKey, rules);
      return { archRules: rules };
    }),
  removeArchRule: (id) =>
    set((s) => {
      const rules = s.archRules.filter((r) => r.id !== id);
      saveArchRules(settingsProjectKey, rules);
      return { archRules: rules };
    }),
  resetArchRules: () =>
    set((s) => {
      const rules = s.graph ? deriveDefaultRules(s.graph) : [];
      saveArchRules(settingsProjectKey, rules);
      return { archRules: rules };
    }),
  publicSurfaceOnly: false,
  togglePublicSurfaceOnly: () =>
    set((s) => ({
      publicSurfaceOnly: !s.publicSurfaceOnly,
      // Visibility filter changes the visible node set → drop container caches.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    })),
  c4Level: readPersisted("ua-c4-level-v1", ["system", "layer", "file"], "layer"),
  setC4Level: (level) => {
    persist("ua-c4-level-v1", level);
    set({ c4Level: level });
  },
  archPanelOpen: false,
  toggleArchPanel: () => set((s) => ({ archPanelOpen: !s.archPanelOpen })),
  setArchPanelOpen: (open) => set({ archPanelOpen: open }),

  // ── Visualization & structural-polish tier ────────────────────────────────
  treemapPanelOpen: false,
  toggleTreemapPanel: () => set((s) => ({ treemapPanelOpen: !s.treemapPanelOpen })),
  setTreemapPanelOpen: (open) => set({ treemapPanelOpen: open }),
  cityPanelOpen: false,
  toggleCityPanel: () => set((s) => ({ cityPanelOpen: !s.cityPanelOpen })),
  setCityPanelOpen: (open) => set({ cityPanelOpen: open }),
  matrixPanelOpen: false,
  toggleMatrixPanel: () => set((s) => ({ matrixPanelOpen: !s.matrixPanelOpen })),
  setMatrixPanelOpen: (open) => set({ matrixPanelOpen: open }),
  readingPanelOpen: false,
  toggleReadingPanel: () => set((s) => ({ readingPanelOpen: !s.readingPanelOpen })),
  setReadingPanelOpen: (open) => set({ readingPanelOpen: open }),
  matrixCellFilter: null,
  setMatrixCellFilter: (cell) => set({ matrixCellFilter: cell }),
  layerOverrides: {},
  setLayerOverride: (layerId, patch) =>
    set((s) => {
      const prev = s.layerOverrides[layerId] ?? {};
      const next: LayerOverrideMap = {
        ...s.layerOverrides,
        [layerId]: {
          ...prev,
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
        },
      };
      saveLayerOverrides(settingsProjectKey, next);
      return { layerOverrides: next };
    }),
  resetLayerOverride: (layerId) =>
    set((s) => {
      const next = { ...s.layerOverrides };
      delete next[layerId];
      saveLayerOverrides(settingsProjectKey, next);
      return { layerOverrides: next };
    }),

  setGraph: (graph) => {
    const searchEngine = new SearchEngine(graph.nodes);
    const query = get().searchQuery;
    const searchResults = query.trim() ? searchEngine.search(query) : [];
    const { viewMode, domainGraph, activeDomainId } = get();
    // Preserve domain view if a domain graph is already loaded
    const keepDomainView = viewMode === "domain" && domainGraph !== null;
    const { nodesById, nodeIdToLayerId, nodeIdToLayerIds, filePathToNodeId } =
      buildGraphIndexes(graph);
    // Item 26: seed boundary rules from persisted state, else derive "no upward
    // deps" defaults from the layer order.
    const persistedRules = loadArchRules(settingsProjectKey);
    const archRules = persistedRules ?? deriveDefaultRules(graph);
    set({
      graph,
      nodesById,
      nodeIdToLayerId,
      nodeIdToLayerIds,
      filePathToNodeId,
      archRules,
      archRulesSeeded: true,
      // Item 190: rebuild the domain-step index against the new structural index
      // (no-op if the domain graph hasn't loaded yet; setDomainGraph rebuilds it).
      nodeIdToDomainStep: buildNodeIdToDomainStep(domainGraph, filePathToNodeId),
      searchEngine,
      searchResults,
      navigationLevel: "overview",
      activeLayerId: null,
      selectedNodeId: null,
      focusNodeId: null,
      nodeHistory: [],
      viewMode: keepDomainView ? "domain" as const : "structural" as const,
      activeDomainId: keepDomainView ? activeDomainId : null,
      containerLayoutCache: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
      containerSizeMemory: new Map(),
      stage1Tick: 0,
      layoutIssues: [],
    });
  },

  selectNode: (nodeId) => {
    const { selectedNodeId, nodeHistory } = get();
    if (nodeId && selectedNodeId && nodeId !== selectedNodeId) {
      // Push current node to history before navigating away
      set({
        selectedNodeId: nodeId,
        nodeHistory: [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY),
      });
    } else {
      set({ selectedNodeId: nodeId });
    }
    // Item 158: count a selected node toward exploration coverage.
    if (nodeId) get().markVisited(nodeId);
  },

  navigateToNode: (nodeId) => {
    get().navigateToNodeInLayer(nodeId);
  },

  navigateToNodeInLayer: (nodeId) => {
    const { graph, selectedNodeId, nodeHistory, nodeIdToLayerId } = get();
    if (!graph) return;
    const layerId = nodeIdToLayerId.get(nodeId) ?? null;
    const newHistory =
      selectedNodeId && nodeId !== selectedNodeId
        ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
        : nodeHistory;
    if (layerId) {
      set({
        navigationLevel: "layer-detail",
        activeLayerId: layerId,
        selectedNodeId: nodeId,
        focusNodeId: null,
        codeViewerOpen: false,
        codeViewerNodeId: null,
        codeViewerExpanded: false,
        nodeHistory: newHistory,
      });
    } else {
      set({
        selectedNodeId: nodeId,
        nodeHistory: newHistory,
      });
    }
  },

  navigateToHistoryIndex: (index) => {
    const { nodeHistory, graph, nodeIdToLayerId } = get();
    if (!graph || index < 0 || index >= nodeHistory.length) return;
    const targetId = nodeHistory[index];
    const newHistory = nodeHistory.slice(0, index);
    const layerId = nodeIdToLayerId.get(targetId) ?? null;
    set({
      selectedNodeId: targetId,
      nodeHistory: newHistory,
      ...(layerId ? { navigationLevel: "layer-detail" as const, activeLayerId: layerId } : {}),
    });
  },

  goBackNode: () => {
    const { nodeHistory, graph, nodeIdToLayerId } = get();
    if (nodeHistory.length === 0 || !graph) return;
    const prevNodeId = nodeHistory[nodeHistory.length - 1];
    const newHistory = nodeHistory.slice(0, -1);
    const layerId = nodeIdToLayerId.get(prevNodeId) ?? null;
    if (layerId) {
      set({
        navigationLevel: "layer-detail",
        activeLayerId: layerId,
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
      });
    } else {
      set({
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
      });
    }
  },

  drillIntoLayer: (layerId) =>
    set({
      navigationLevel: "layer-detail",
      activeLayerId: layerId,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
      // Container ids derive from folder names and collide across layers
      // (e.g. `container:auth` exists in many layers). Drop the cache so
      // we don't render stale positions for the new layer's children.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  navigateToOverview: () =>
    set({
      navigationLevel: "overview",
      activeLayerId: null,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  setFocusNode: (nodeId) =>
    set({
      focusNodeId: nodeId,
      selectedNodeId: nodeId,
      // Focus mode narrows filteredGraphNodes to focus + 1-hop; the
      // surviving containers have a subset of their original children,
      // and the cache must not return positions for filtered-out ids.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),
  setSearchMode: (mode) => {
    persist("ua-search-mode-v1", mode);
    set({ searchMode: mode });
    // Re-run the live query under the new mode so results update immediately.
    const q = get().searchQuery;
    if (q.trim()) get().setSearchQuery(q);
  },
  setSearchQuery: (query) => {
    const engine = get().searchEngine;
    const mode = get().searchMode;
    if (!engine || !query.trim()) {
      set({ searchQuery: query, searchResults: [], searchCycleIndex: -1 });
      return;
    }

    // Item 66: peel off scoped prefixes (type:/layer:/tag:/pkg:) before ranking.
    const scope = parseScopes(query);
    const free = scope.rest;
    const { graph, nodeIdToLayerIds } = get();
    const layerNameById = new Map<string, string>();
    if (graph) for (const l of graph.layers) layerNameById.set(l.id, l.name);
    const inScope = (nodeId: string): boolean => {
      if (!scope.hasScope) return true;
      const node = get().nodesById.get(nodeId);
      if (!node) return false;
      return nodeMatchesScope(node, scope, nodeIdToLayerIds, layerNameById);
    };

    const allNodes = graph?.nodes ?? [];
    let raw: { nodeId: string; score: number }[];
    if (mode === "regex") {
      // Item 65: regex / glob over name + filePath. Empty free-text but a
      // scope present → list everything matching the scope (score 0).
      if (!free) {
        raw = scope.hasScope ? allNodes.map((n) => ({ nodeId: n.id, score: 0 })) : [];
      } else {
        const pattern = compilePattern(free);
        raw = pattern ? regexSearch(pattern, allNodes, 100) : [];
      }
    } else {
      // fuzzy / semantic (semantic currently aliases fuzzy until embeddings).
      void mode;
      if (!free) {
        raw = scope.hasScope ? allNodes.map((n) => ({ nodeId: n.id, score: 0 })) : [];
      } else {
        raw = engine.search(free);
      }
    }

    const searchResults = raw.filter((r) => inScope(r.nodeId));
    set({ searchQuery: query, searchResults, searchCycleIndex: -1 });
  },

  // ── Search result cycling (item 67) ────────────────────────────────────────
  cycleSearchResult: (dir) => {
    const { searchResults, searchCycleIndex } = get();
    if (searchResults.length === 0) return;
    const n = searchResults.length;
    const next = ((searchCycleIndex + dir) % n + n) % n;
    const target = searchResults[next];
    set({ searchCycleIndex: next });
    // Focus + pan to the match using the existing selection→center plumbing.
    get().focusEntity(target.nodeId, { view: "structural" });
  },

  // ── Recent + starred searches (item 69) ────────────────────────────────────
  commitRecentSearch: (query) => {
    const q = query.trim();
    if (!q) return;
    const next = pushRecentSearch(get().searchHistory, q);
    saveSearchHistory(settingsProjectKey, next);
    set({ searchHistory: next });
  },
  toggleStarredSearch: (query) => {
    const next = toggleStarredHist(get().searchHistory, query);
    saveSearchHistory(settingsProjectKey, next);
    set({ searchHistory: next });
  },

  // ── Pinned / frozen node positions (item 50) ───────────────────────────────
  pinNodePosition: (nodeId, pos) => {
    const next = { ...get().pinnedPositions, [nodeId]: { x: pos.x, y: pos.y } };
    savePinnedPositions(settingsProjectKey, next);
    set({ pinnedPositions: next });
  },
  unpinNodePosition: (nodeId) => {
    const next = { ...get().pinnedPositions };
    if (!(nodeId in next)) return;
    delete next[nodeId];
    savePinnedPositions(settingsProjectKey, next);
    set({ pinnedPositions: next });
  },
  toggleNodePin: (nodeId, pos) => {
    if (get().pinnedPositions[nodeId]) {
      get().unpinNodePosition(nodeId);
    } else if (pos) {
      get().pinNodePosition(nodeId, pos);
    }
  },
  isNodePinned: (nodeId) => !!get().pinnedPositions[nodeId],
  clearPinnedPositions: () => {
    savePinnedPositions(settingsProjectKey, {});
    set({ pinnedPositions: {} });
  },

  setPersona: (persona) =>
    set({
      persona,
      // Persona changes filter node types, which shifts container.nodeIds.
      containerLayoutCache: new Map(),
      containerSizeMemory: new Map(),
      expandedContainers: new Set(),
      pendingFocusContainer: null,
    }),

  openCodeViewer: (nodeId) =>
    set({ codeViewerOpen: true, codeViewerNodeId: nodeId, codeViewerExpanded: false }),
  closeCodeViewer: () =>
    set({ codeViewerOpen: false, codeViewerNodeId: null, codeViewerExpanded: false }),
  expandCodeViewer: () => set({ codeViewerExpanded: true }),
  collapseCodeViewer: () => set({ codeViewerExpanded: false }),

  setDiffOverlay: (changed, affected) =>
    set({
      diffMode: true,
      changedNodeIds: new Set(changed),
      affectedNodeIds: new Set(affected),
    }),

  toggleDiffMode: () => set((state) => ({ diffMode: !state.diffMode })),

  clearDiffOverlay: () =>
    set({
      diffMode: false,
      changedNodeIds: new Set<string>(),
      affectedNodeIds: new Set<string>(),
    }),

  toggleFilterPanel: () => set((state) => ({
    filterPanelOpen: !state.filterPanelOpen,
    exportMenuOpen: false,
  })),

  toggleExportMenu: () => set((state) => ({
    exportMenuOpen: !state.exportMenuOpen,
    filterPanelOpen: false,
  })),

  togglePathFinder: () => set((state) => ({
    pathFinderOpen: !state.pathFinderOpen,
  })),

  setReactFlowInstance: (instance) => set({ reactFlowInstance: instance }),

  setFilters: (newFilters) => set((state) => ({
    filters: { ...state.filters, ...newFilters },
  })),

  resetFilters: () => set({
    filters: {
      nodeTypes: new Set<NodeType>(ALL_NODE_TYPES),
      complexities: new Set<Complexity>(ALL_COMPLEXITIES),
      layerIds: new Set<string>(),
      edgeCategories: new Set<EdgeCategory>(ALL_EDGE_CATEGORIES),
    },
  }),

  hasActiveFilters: () => {
    const { filters } = get();
    return filters.nodeTypes.size !== ALL_NODE_TYPES.length
      || filters.complexities.size !== ALL_COMPLEXITIES.length
      || filters.layerIds.size > 0
      || filters.edgeCategories.size !== ALL_EDGE_CATEGORIES.length;
  },

  startTour: () => {
    const state = get();
    const { graph, nodeIdToLayerId, activeLayerId } = state;
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[0].nodeIds);
    set({
      tourActive: true,
      currentTourStep: 0,
      tourHighlightedNodeIds: sorted[0].nodeIds,
      selectedNodeId: null,
      // Item 140: a step may want a non-structural view; default structural.
      viewMode: tourStepView(sorted[0]),
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
      ...persistTourProgress(state, 0, true),
    });
  },

  resumeTour: () => {
    const state = get();
    const { graph, nodeIdToLayerId, activeLayerId } = state;
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    const step = Math.min(Math.max(0, state.learning.tourStep), sorted.length - 1);
    const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[step].nodeIds);
    set({
      tourActive: true,
      currentTourStep: step,
      tourHighlightedNodeIds: sorted[step].nodeIds,
      selectedNodeId: null,
      viewMode: tourStepView(sorted[step]),
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
      ...persistTourProgress(state, step, true),
    });
  },

  stopTour: () =>
    set((state) => ({
      tourActive: false,
      currentTourStep: 0,
      tourHighlightedNodeIds: [],
      ...persistTourProgress(state, state.currentTourStep, false),
    })),

  setTourStep: (step) => {
    const state = get();
    const { graph, nodeIdToLayerId, activeLayerId } = state;
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    if (step < 0 || step >= sorted.length) return;
    const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[step].nodeIds);
    set({
      currentTourStep: step,
      tourHighlightedNodeIds: sorted[step].nodeIds,
      viewMode: tourStepView(sorted[step]),
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
      ...persistTourProgress(state, step, true),
    });
  },

  nextTourStep: () => {
    const state = get();
    const { graph, currentTourStep, nodeIdToLayerId, activeLayerId } = state;
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    if (currentTourStep < sorted.length - 1) {
      const next = currentTourStep + 1;
      const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[next].nodeIds);
      set({
        currentTourStep: next,
        tourHighlightedNodeIds: sorted[next].nodeIds,
        viewMode: tourStepView(sorted[next]),
        ...layerNav,
        ...layerResetIfChanged(layerNav, activeLayerId),
        ...persistTourProgress(state, next, true),
      });
    }
  },

  prevTourStep: () => {
    const state = get();
    const { graph, currentTourStep, nodeIdToLayerId, activeLayerId } = state;
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    if (currentTourStep > 0) {
      const sorted = getSortedTour(graph);
      const prev = currentTourStep - 1;
      const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[prev].nodeIds);
      set({
        currentTourStep: prev,
        tourHighlightedNodeIds: sorted[prev].nodeIds,
        viewMode: tourStepView(sorted[prev]),
        ...layerNav,
        ...layerResetIfChanged(layerNav, activeLayerId),
        ...persistTourProgress(state, prev, true),
      });
    }
  },

  viewMode: "structural",
  isKnowledgeGraph: false,
  domainGraph: null,
  activeDomainId: null,

  traceRoot: null,
  traceStack: [],
  setTraceRoot: (id) => set({ traceRoot: id, traceStack: [id], tracePathTarget: null }),
  pushTrace: (id) =>
    set((state) => {
      // Avoid pushing a duplicate of the current focus node.
      if (state.traceStack[state.traceStack.length - 1] === id) return {};
      return { traceStack: [...state.traceStack, id], tracePathTarget: null };
    }),
  popTrace: () =>
    set((state) => {
      if (state.traceStack.length <= 1) return {};
      return { traceStack: state.traceStack.slice(0, -1) };
    }),
  truncateTrace: (length) =>
    set((state) => {
      const n = Math.max(1, Math.min(length, state.traceStack.length));
      if (n === state.traceStack.length) return {};
      return { traceStack: state.traceStack.slice(0, n) };
    }),

  // ---- Wave-1 trace navigation UI state --------------------------------
  traceDirection: "callees",
  setTraceDirection: (dir) => set({ traceDirection: dir }),
  traceDepth: 4,
  setTraceDepth: (depth) => set({ traceDepth: Math.max(1, Math.min(6, depth)) }),
  traceLayout: "nested",
  setTraceLayout: (layout) => set({ traceLayout: layout }),
  traceFoldedPatterns: [],
  addFoldPattern: (pattern) =>
    set((state) => {
      const p = pattern.trim();
      if (!p || state.traceFoldedPatterns.includes(p)) return {};
      return { traceFoldedPatterns: [...state.traceFoldedPatterns, p] };
    }),
  removeFoldPattern: (pattern) =>
    set((state) => ({
      traceFoldedPatterns: state.traceFoldedPatterns.filter((p) => p !== pattern),
    })),
  traceUnfolded: new Set<string>(),
  toggleUnfold: (nodeId) =>
    set((state) => {
      const next = new Set(state.traceUnfolded);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { traceUnfolded: next };
    }),
  traceMutedPackages: new Set<string>(),
  toggleMutedPackage: (pkg) =>
    set((state) => {
      const next = new Set(state.traceMutedPackages);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return { traceMutedPackages: next };
    }),
  traceMuteSeeded: false,
  seedMutedPackages: (pkgs) =>
    set((state) => {
      if (state.traceMuteSeeded) return {};
      const next = new Set(state.traceMutedPackages);
      for (const p of pkgs) next.add(p);
      return { traceMutedPackages: next, traceMuteSeeded: true };
    }),
  traceCriticalPath: false,
  toggleCriticalPath: () => set((s) => ({ traceCriticalPath: !s.traceCriticalPath })),
  tracePathTarget: null,
  setPathTarget: (id) => set({ tracePathTarget: id }),
  traceColorBy: "none",
  setTraceColorBy: (dim) => set({ traceColorBy: dim }),

  // ---- Wave-3 interactive-debugging UI state ---------------------------
  tracePredicate: "",
  setPredicate: (p) => set({ tracePredicate: p }),
  tracePredicateFilter: false,
  togglePredicateFilter: () => set((s) => ({ tracePredicateFilter: !s.tracePredicateFilter })),
  traceErrorPath: false,
  toggleErrorPath: () => set((s) => ({ traceErrorPath: !s.traceErrorPath })),
  traceHeat: false,
  toggleHeat: () => set((s) => ({ traceHeat: !s.traceHeat })),
  traceSnapshots: [],
  traceDiffBaseline: null,
  snapshotTrace: (name, ids) => {
    const id = genId("snap");
    set((s) => ({
      traceSnapshots: [
        ...s.traceSnapshots,
        { id, name, ids, createdAt: new Date().toISOString() },
      ],
      // Auto-arm the diff baseline to the just-captured snapshot.
      traceDiffBaseline: id,
    }));
    return id;
  },
  removeSnapshot: (id) =>
    set((s) => ({
      traceSnapshots: s.traceSnapshots.filter((sn) => sn.id !== id),
      traceDiffBaseline: s.traceDiffBaseline === id ? null : s.traceDiffBaseline,
    })),
  setDiffBaseline: (id) => set({ traceDiffBaseline: id }),

  // ---- Wave-2: symbol palette + trace-from-anywhere --------------------
  symbolPaletteOpen: false,
  toggleSymbolPalette: () => set((s) => ({ symbolPaletteOpen: !s.symbolPaletteOpen })),
  setSymbolPaletteOpen: (open) => set({ symbolPaletteOpen: open }),
  startTraceAt: (id) => {
    set({
      traceRoot: id,
      traceStack: [id],
      tracePathTarget: null,
      viewMode: "trace",
      selectedNodeId: id,
      symbolPaletteOpen: false,
    });
    // Items 158/161: a trace counts toward coverage + checks the "traced" box.
    get().markVisited(id);
    get().markChecklist("didTrace");
    // Item 187: record the trace target as a recent destination.
    get().recordRecent(id);
    // Item 200c: announce the trace for screen readers.
    const node = get().graph?.nodes.find((n) => n.id === id);
    if (node) get().announce(`Now in Trace view, tracing from ${node.name}`);
  },

  // ---- Workspace persistence -------------------------------------------
  workspace: EMPTY_WORKSPACE,
  workspaceLoaded: false,
  bookmarksPanelOpen: false,
  toggleBookmarksPanel: () => set((s) => ({ bookmarksPanelOpen: !s.bookmarksPanelOpen })),

  loadWorkspace: (ws) =>
    set({ workspace: { ...EMPTY_WORKSPACE, ...ws }, workspaceLoaded: true }),

  toggleBookmark: (nodeId, label) =>
    set((state) => {
      const exists = state.workspace.bookmarks.some((b) => b.nodeId === nodeId);
      const bookmarks = exists
        ? state.workspace.bookmarks.filter((b) => b.nodeId !== nodeId)
        : [
            ...state.workspace.bookmarks,
            { id: genId("bm"), nodeId, label, createdAt: new Date().toISOString() },
          ];
      const workspace = { ...state.workspace, bookmarks };
      schedulePersist(workspace);
      return { workspace };
    }),

  isBookmarked: (nodeId) => get().workspace.bookmarks.some((b) => b.nodeId === nodeId),

  addAnnotation: (nodeId, text, lineRange = null) =>
    set((state) => {
      const annotations = [
        ...state.workspace.annotations,
        { id: genId("an"), nodeId, lineRange, text, createdAt: new Date().toISOString() },
      ];
      const workspace = { ...state.workspace, annotations };
      schedulePersist(workspace);
      return { workspace };
    }),

  removeAnnotation: (id) =>
    set((state) => {
      const annotations = state.workspace.annotations.filter((a) => a.id !== id);
      const workspace = { ...state.workspace, annotations };
      schedulePersist(workspace);
      return { workspace };
    }),

  setNodeSession: (nodeId, sessionId) =>
    set((state) => {
      if (state.workspace.sessions[nodeId] === sessionId) return {};
      const sessions = { ...state.workspace.sessions, [nodeId]: sessionId };
      const workspace = { ...state.workspace, sessions };
      schedulePersist(workspace);
      return { workspace };
    }),

  getNodeSession: (nodeId) => get().workspace.sessions[nodeId],

  addWatch: (symbol) =>
    set((state) => {
      if (state.workspace.watches.includes(symbol)) return {};
      const workspace = { ...state.workspace, watches: [...state.workspace.watches, symbol] };
      schedulePersist(workspace);
      return { workspace };
    }),

  removeWatch: (symbol) =>
    set((state) => {
      const workspace = {
        ...state.workspace,
        watches: state.workspace.watches.filter((w) => w !== symbol),
      };
      schedulePersist(workspace);
      return { workspace };
    }),

  saveTour: (name, hopIds) =>
    set((state) => {
      const tours = [
        ...state.workspace.tours,
        { id: genId("tour"), name, hopIds, createdAt: new Date().toISOString() },
      ];
      const workspace = { ...state.workspace, tours };
      schedulePersist(workspace);
      return { workspace };
    }),

  removeTour: (id) =>
    set((state) => {
      const tours = state.workspace.tours.filter((t) => t.id !== id);
      const workspace = { ...state.workspace, tours };
      schedulePersist(workspace);
      return { workspace };
    }),

  // ---- Onboarding / teaching state (items 131-165) ----------------------
  learning: { ...EMPTY_LEARNING },
  learningLoaded: false,
  flashcardReviews: {},
  visitRecap: null,

  loadLearning: (projectKey) => {
    learningProjectKey = projectKey || "default";
    // Items 187/200b: hydrate settings + recent/pinned destinations for the same
    // project key (localStorage — they're outside the workspace whitelist).
    settingsProjectKey = learningProjectKey;
    const settings = loadSettings(settingsProjectKey);
    const destinations = loadDestinations(settingsProjectKey);
    // Item 26: now that the project key is known, hydrate persisted boundary
    // rules (falling back to the freshly-derived defaults if none saved yet).
    const persistedRules = loadArchRules(settingsProjectKey);
    const archRules =
      persistedRules ??
      (get().graph ? deriveDefaultRules(get().graph!) : get().archRules);
    // Item 172: compute the "what changed since I was last here" recap by
    // diffing the current graph against the persisted last-visit snapshot, then
    // write a fresh snapshot for next time.
    const hydratedLearning = loadLearning(learningProjectKey);
    const visitRecap = computeVisitRecap(
      get().graph,
      loadVisitSnapshot(learningProjectKey),
    );
    if (get().graph) {
      saveVisitSnapshot(learningProjectKey, snapshotGraph(get().graph!));
    }
    set({
      learning: hydratedLearning,
      learningLoaded: true,
      flashcardReviews: loadFlashcardReviews(learningProjectKey),
      visitRecap,
      settings,
      destinations,
      archRules,
      layerOverrides: loadLayerOverrides(settingsProjectKey),
      // 200-series 69/50: hydrate recent/starred searches + pinned positions.
      searchHistory: loadSearchHistory(settingsProjectKey),
      pinnedPositions: loadPinnedPositions(settingsProjectKey),
      // Apply persisted trace defaults at load.
      traceDepth: Math.max(1, Math.min(6, settings.defaultTraceDepth)),
      traceDirection: settings.defaultTraceDirection,
    });
  },

  setOnboardingGoal: (goal) =>
    set((s) => {
      const learning = { ...s.learning, onboardingGoal: goal };
      saveLearning(learningProjectKey, learning);
      return { learning };
    }),

  toggleLanguageAxis: () =>
    set((s) => {
      const learning = { ...s.learning, languageAxis: !s.learning.languageAxis };
      saveLearning(learningProjectKey, learning);
      return { learning };
    }),

  markVisited: (nodeId) =>
    set((s) => {
      if (!nodeId || s.learning.visitedNodeIds.includes(nodeId)) return {};
      const learning = {
        ...s.learning,
        visitedNodeIds: [...s.learning.visitedNodeIds, nodeId],
      };
      saveLearning(learningProjectKey, learning);
      return { learning };
    }),

  dismissChecklist: () =>
    set((s) => {
      const learning = { ...s.learning, checklistDismissed: true };
      saveLearning(learningProjectKey, learning);
      return { learning };
    }),

  markChecklist: (key) =>
    set((s) => {
      if (s.learning[key]) return {};
      const learning = { ...s.learning, [key]: true };
      saveLearning(learningProjectKey, learning);
      return { learning };
    }),

  // ---- 200-series teaching long-tail (items 154/157/163/172) ------------
  toggleModuleComplete: (moduleId) =>
    set((s) => {
      const done = new Set(s.learning.completedModules);
      if (done.has(moduleId)) done.delete(moduleId);
      else done.add(moduleId);
      const learning = { ...s.learning, completedModules: Array.from(done) };
      saveLearning(learningProjectKey, learning);
      return { learning };
    }),

  setCurriculumTrack: (track) =>
    set((s) => {
      if (s.learning.curriculumTrack === track) return {};
      const learning = { ...s.learning, curriculumTrack: track };
      saveLearning(learningProjectKey, learning);
      return { learning };
    }),

  gradeFlashcard: (cardId, correct) =>
    set((s) => {
      const next = {
        ...s.flashcardReviews,
        [cardId]: gradeCard(s.flashcardReviews[cardId], correct),
      };
      saveFlashcardReviews(learningProjectKey, next);
      return { flashcardReviews: next };
    }),

  dismissRecap: () =>
    set((s) => {
      if (!s.visitRecap) return {};
      const learning = {
        ...s.learning,
        recapDismissedFor: s.visitRecap.signature,
      };
      saveLearning(learningProjectKey, learning);
      return { learning, visitRecap: null };
    }),

  // ---- Wave-4: converse-with-Claude state -------------------------------
  setRules: (rules) =>
    set((state) => {
      if (state.workspace.rules === rules) return {};
      const workspace = { ...state.workspace, rules };
      schedulePersist(workspace);
      return { workspace };
    }),

  traceLevel: "beginner",
  setTraceLevel: (traceLevel) => set({ traceLevel }),

  goDocs: false,
  toggleGoDocs: () => set((s) => ({ goDocs: !s.goDocs })),

  contextChips: [],
  addContextChip: (chip) =>
    set((s) =>
      s.contextChips.some((c) => c.id === chip.id)
        ? {}
        : { contextChips: [...s.contextChips, chip] },
    ),
  removeContextChip: (id) =>
    set((s) => ({ contextChips: s.contextChips.filter((c) => c.id !== id) })),
  clearContextChips: () => set({ contextChips: [] }),

  setDomainGraph: (graph) => {
    // Item 190: (re)build the structural-node → domain-step index now that we
    // have both graphs available (filePathToNodeId was built by setGraph).
    const { filePathToNodeId } = get();
    set({
      domainGraph: graph,
      nodeIdToDomainStep: buildNodeIdToDomainStep(graph, filePathToNodeId),
    });
  },

  setIsKnowledgeGraph: (value) => {
    set({ isKnowledgeGraph: value });
  },

  setViewMode: (mode, opts) => {
    const keepSelection = opts?.keepSelection ?? true;
    const { selectedNodeId, traceRoot, nodeIdToLayerId } = get();
    // Always close the code viewer when switching the top-level view.
    // Item 200c: announce the view change for screen readers.
    const viewLabel =
      mode === "structural"
        ? "Structural graph"
        : mode === "domain"
          ? "Domain flows"
          : mode === "trace"
            ? "Trace view"
            : mode === "data"
              ? "Data / ERD view"
              : "Knowledge graph";
    const base = {
      viewMode: mode,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
      ariaAnnouncement: `Now in ${viewLabel}`,
    };
    if (!keepSelection || !selectedNodeId) {
      set({ ...base, selectedNodeId: null, focusNodeId: null });
      return;
    }
    // K2: carry the focused node across views, wiring the right per-view target.
    if (mode === "trace") {
      // Re-root the trace at the focused node (preserve existing root if it
      // already matches so we don't blow away a deep breadcrumb).
      const patch: Partial<DashboardStore> =
        traceRoot === selectedNodeId
          ? {}
          : { traceRoot: selectedNodeId, traceStack: [selectedNodeId], tracePathTarget: null };
      set({ ...base, ...patch });
    } else if (mode === "structural") {
      // Land on the node in its layer so it's actually visible.
      const layerId = nodeIdToLayerId.get(selectedNodeId) ?? null;
      set({
        ...base,
        ...(layerId
          ? { navigationLevel: "layer-detail" as const, activeLayerId: layerId }
          : {}),
      });
    } else {
      // domain / knowledge: keep the selection; the view will surface it.
      set(base);
    }
  },

  focusEntity: (nodeId, opts) => {
    const view = opts?.view ?? get().viewMode;
    // Item 187: every focus records a recent destination.
    get().recordRecent(nodeId);
    // Item 200c: announce the cross-view jump for screen readers.
    const node =
      get().graph?.nodes.find((n) => n.id === nodeId) ??
      get().domainGraph?.nodes.find((n) => n.id === nodeId);
    if (node) get().announce(`Now in ${view} view, focused on ${node.name}`);
    if (view === "trace") {
      get().startTraceAt(nodeId);
    } else if (view === "domain") {
      set({ viewMode: "domain", selectedNodeId: nodeId });
    } else if (view === "knowledge") {
      set({ viewMode: "knowledge", selectedNodeId: nodeId });
    } else if (view === "data") {
      set({ viewMode: "data", selectedNodeId: nodeId });
    } else {
      // structural — navigate into the node's layer and select it.
      set({ viewMode: "structural" });
      get().navigateToNodeInLayer(nodeId);
    }
  },

  contextMenu: null,
  openContextMenu: (nodeId, x, y) => set({ contextMenu: { nodeId, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),

  // ---- Integration / app-wide-polish (items 187/200b/200c) ---------------
  destinations: { ...EMPTY_DESTINATIONS },
  recordRecent: (nodeId) => {
    const { graph, domainGraph, destinations } = get();
    const node =
      graph?.nodes.find((n) => n.id === nodeId) ??
      domainGraph?.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const entry: RecentEntity = {
      nodeId,
      name: node.name,
      type: node.type,
      at: Date.now(),
    };
    const next = pushRecent(destinations, entry);
    saveDestinations(settingsProjectKey, next);
    set({ destinations: next });
  },
  togglePinnedDestination: (nodeId) => {
    const { graph, domainGraph, destinations } = get();
    const node =
      graph?.nodes.find((n) => n.id === nodeId) ??
      domainGraph?.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const next = togglePinnedDest(destinations, {
      nodeId,
      name: node.name,
      type: node.type,
    });
    saveDestinations(settingsProjectKey, next);
    set({ destinations: next });
  },
  isPinnedDestination: (nodeId) =>
    get().destinations.pinned.some((p) => p.nodeId === nodeId),

  settings: { ...DEFAULT_SETTINGS },
  settingsModalOpen: false,
  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(settingsProjectKey, next);
    // Apply trace defaults live so the change is immediate, not just on reload.
    const live: Partial<DashboardStore> = { settings: next };
    if (patch.defaultTraceDepth !== undefined) {
      live.traceDepth = Math.max(1, Math.min(6, patch.defaultTraceDepth));
    }
    if (patch.defaultTraceDirection !== undefined) {
      live.traceDirection = patch.defaultTraceDirection;
    }
    set(live);
  },

  ariaAnnouncement: "",
  announce: (message) => set({ ariaAnnouncement: message }),

  openSearchResult: (nodeId, kind, domainId) => {
    get().recordRecent(nodeId);
    if (kind === "trace") {
      get().startTraceAt(nodeId);
    } else if (kind === "domain") {
      // Enter the owning domain first, then select the flow/step node within it.
      if (domainId) get().navigateToDomain(domainId);
      set({ viewMode: "domain", selectedNodeId: nodeId });
      const node = get().domainGraph?.nodes.find((n) => n.id === nodeId);
      get().announce(`Now in Domain view${node ? `, focused on ${node.name}` : ""}`);
    } else if (kind === "code") {
      // Open the structural node + its source.
      get().focusEntity(nodeId, { view: "structural" });
      get().openCodeViewer(nodeId);
    } else {
      get().focusEntity(nodeId, { view: "structural" });
    }
  },

  navigateToDomain: (domainId) => {
    const { selectedNodeId, nodeHistory } = get();
    const newHistory = selectedNodeId
      ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
      : nodeHistory;
    set({
      viewMode: "domain" as const,
      activeDomainId: domainId,
      focusNodeId: null,
      nodeHistory: newHistory,
      // Entering a domain resets per-domain detail UI (focus-a-flow / accordion).
      focusedFlowId: null,
    });
  },

  clearActiveDomain: () => {
    set({
      activeDomainId: null,
      selectedNodeId: null,
      focusNodeId: null,
      focusedFlowId: null,
    });
  },

  // ---- Domain business-flow actions (91/93/99/113/110/106) --------------
  expandedDomainFlows: new Set<string>(),
  toggleDomainFlowsExpanded: (domainId) => {
    set((s) => {
      const next = new Set(s.expandedDomainFlows);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return { expandedDomainFlows: next };
    });
    // Item 161: opening a domain flow checks the "read a domain flow" box.
    get().markChecklist("readDomainFlow");
  },
  focusedFlowId: null,
  setFocusedFlow: (flowId) => set({ focusedFlowId: flowId }),
  domainStorylineMode: false,
  toggleDomainStoryline: () =>
    set((s) => ({ domainStorylineMode: !s.domainStorylineMode })),
  domainSearchQuery: "",
  setDomainSearchQuery: (q) => set({ domainSearchQuery: q }),

  /** Feature 110/105: focus the structural file node behind a domain step. */
  openStepFile: (stepNodeId) => {
    const { domainGraph, filePathToNodeId } = get();
    const step = domainGraph?.nodes.find((n) => n.id === stepNodeId);
    const fp = step?.filePath;
    if (!fp) return;
    const structuralId = filePathToNodeId.get(fp);
    if (!structuralId) return;
    // Bridge: jump into the structural graph on that file, then open its source.
    get().focusEntity(structuralId, { view: "structural" });
    get().openCodeViewer(structuralId);
  },

  /** Feature 106: "Trace this code" — re-root the trace at the step's file. */
  traceStepCode: (stepNodeId) => {
    const { domainGraph, filePathToNodeId } = get();
    const step = domainGraph?.nodes.find((n) => n.id === stepNodeId);
    const fp = step?.filePath;
    if (!fp) return;
    const structuralId = filePathToNodeId.get(fp);
    if (!structuralId) return;
    get().startTraceAt(structuralId);
    get().setViewMode("trace");
  },

  expandedContainers: new Set<string>(),
  pendingFocusContainer: null,
  setPendingFocusContainer: (containerId) =>
    set({ pendingFocusContainer: containerId }),
  tourFitPending: false,
  setTourFitPending: (pending) => set({ tourFitPending: pending }),
  toggleContainer: (containerId) =>
    set((state) => {
      const next = new Set(state.expandedContainers);
      const willExpand = !next.has(containerId);
      if (willExpand) next.add(containerId);
      else next.delete(containerId);
      return {
        expandedContainers: next,
        pendingFocusContainer: willExpand
          ? containerId
          : state.pendingFocusContainer,
      };
    }),
  expandContainer: (containerId) =>
    set((state) => {
      if (state.expandedContainers.has(containerId)) return {};
      const next = new Set(state.expandedContainers);
      next.add(containerId);
      return { expandedContainers: next };
    }),
  collapseContainer: (containerId) =>
    set((state) => {
      if (!state.expandedContainers.has(containerId)) return {};
      const next = new Set(state.expandedContainers);
      next.delete(containerId);
      return { expandedContainers: next };
    }),
  collapseAllContainers: () => set({ expandedContainers: new Set() }),
  expandAllContainers: (containerIds) =>
    set({ expandedContainers: new Set(containerIds) }),

  containerLayoutCache: new Map(),
  setContainerLayout: (containerId, childPositions, actualSize) =>
    set((state) => {
      const next = new Map(state.containerLayoutCache);
      next.set(containerId, { childPositions, actualSize });
      const sizeNext = new Map(state.containerSizeMemory);
      sizeNext.set(containerId, actualSize);
      return { containerLayoutCache: next, containerSizeMemory: sizeNext };
    }),
  clearContainerLayouts: () =>
    set({ containerLayoutCache: new Map(), expandedContainers: new Set(), pendingFocusContainer: null }),

  containerSizeMemory: new Map(),

  stage1Tick: 0,
  bumpStage1Tick: () => set((s) => ({ stage1Tick: s.stage1Tick + 1 })),

  layoutIssues: [],
  appendLayoutIssues: (issues) =>
    set((state) => {
      if (issues.length === 0) return {};
      // Dedupe by level+message so a re-running effect doesn't repeatedly
      // pile up identical issues.
      const seen = new Set(
        state.layoutIssues.map((i) => `${i.level}|${i.message}`),
      );
      const fresh = issues.filter((i) => !seen.has(`${i.level}|${i.message}`));
      if (fresh.length === 0) return {};
      return { layoutIssues: [...state.layoutIssues, ...fresh] };
    }),
  clearLayoutIssues: () => set({ layoutIssues: [] }),
}));


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

export type Persona = "non-technical" | "junior" | "experienced";
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
export type NodeType = "file" | "function" | "class" | "module" | "concept" | "config" | "document" | "service" | "table" | "endpoint" | "pipeline" | "schema" | "resource" | "domain" | "flow" | "step" | "article" | "entity" | "topic" | "claim" | "source";
export type Complexity = "simple" | "moderate" | "complex";
export type EdgeCategory = "structural" | "behavioral" | "data-flow" | "dependencies" | "semantic" | "infrastructure" | "domain" | "knowledge";
export type ViewMode = "structural" | "domain" | "knowledge" | "trace";
export type DetailLevel = "file" | "class";

export interface FilterState {
  nodeTypes: Set<NodeType>;
  complexities: Set<Complexity>;
  layerIds: Set<string>;
  edgeCategories: Set<EdgeCategory>;
}

export const ALL_NODE_TYPES: NodeType[] = ["file", "function", "class", "module", "concept", "config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource", "domain", "flow", "step", "article", "entity", "topic", "claim", "source"];
export const ALL_COMPLEXITIES: Complexity[] = ["simple", "moderate", "complex"];
export const ALL_EDGE_CATEGORIES: EdgeCategory[] = ["structural", "behavioral", "data-flow", "dependencies", "semantic", "infrastructure", "domain", "knowledge"];

export const EDGE_CATEGORY_MAP: Record<EdgeCategory, string[]> = {
  structural: ["imports", "exports", "contains", "inherits", "implements"],
  behavioral: ["calls", "subscribes", "publishes", "middleware"],
  "data-flow": ["reads_from", "writes_to", "transforms", "validates"],
  dependencies: ["depends_on", "tested_by", "configures"],
  semantic: ["related", "similar_to"],
  infrastructure: ["deploys", "serves", "provisions", "triggers", "migrates", "documents", "routes", "defines_schema"],
  domain: ["contains_flow", "flow_step", "cross_domain"],
  knowledge: ["cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by"],
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
  return { nodesById, nodeIdToLayerId, nodeIdToLayerIds };
}

/** Maximum number of entries in the sidebar navigation history. */
const MAX_HISTORY = 50;

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
  selectedNodeId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchEngine: SearchEngine | null;
  searchMode: "fuzzy" | "semantic";
  setSearchMode: (mode: "fuzzy" | "semantic") => void;

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
  stopTour: () => void;
  setTourStep: (step: number) => void;
  nextTourStep: () => void;
  prevTourStep: () => void;

  // View mode
  viewMode: ViewMode;
  isKnowledgeGraph: boolean;
  domainGraph: KnowledgeGraph | null;
  activeDomainId: string | null;

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
  setViewMode: (mode: ViewMode) => void;
  setIsKnowledgeGraph: (value: boolean) => void;
  navigateToDomain: (domainId: string) => void;
  clearActiveDomain: () => void;

  // Container expand/collapse + lazy layout caches
  expandedContainers: Set<string>;
  toggleContainer: (containerId: string) => void;
  expandContainer: (containerId: string) => void;
  collapseContainer: (containerId: string) => void;
  collapseAllContainers: () => void;
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

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  graph: null,
  nodesById: new Map<string, GraphNode>(),
  nodeIdToLayerId: new Map<string, string>(),
  nodeIdToLayerIds: new Map<string, Set<string>>(),
  selectedNodeId: null,
  searchQuery: "",
  searchResults: [],
  searchEngine: null,
  searchMode: "fuzzy",

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

  setGraph: (graph) => {
    const searchEngine = new SearchEngine(graph.nodes);
    const query = get().searchQuery;
    const searchResults = query.trim() ? searchEngine.search(query) : [];
    const { viewMode, domainGraph, activeDomainId } = get();
    // Preserve domain view if a domain graph is already loaded
    const keepDomainView = viewMode === "domain" && domainGraph !== null;
    const { nodesById, nodeIdToLayerId, nodeIdToLayerIds } = buildGraphIndexes(graph);
    set({
      graph,
      nodesById,
      nodeIdToLayerId,
      nodeIdToLayerIds,
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
  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchQuery: (query) => {
    const engine = get().searchEngine;
    const mode = get().searchMode;
    if (!engine || !query.trim()) {
      set({ searchQuery: query, searchResults: [] });
      return;
    }
    // Currently both modes use the same fuzzy engine
    // When embeddings are available, "semantic" mode will use SemanticSearchEngine
    void mode;
    const searchResults = engine.search(query);
    set({ searchQuery: query, searchResults });
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
    const { graph, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[0].nodeIds);
    set({
      tourActive: true,
      currentTourStep: 0,
      tourHighlightedNodeIds: sorted[0].nodeIds,
      selectedNodeId: null,
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
    });
  },

  stopTour: () =>
    set({
      tourActive: false,
      currentTourStep: 0,
      tourHighlightedNodeIds: [],
    }),

  setTourStep: (step) => {
    const { graph, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    if (step < 0 || step >= sorted.length) return;
    const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[step].nodeIds);
    set({
      currentTourStep: step,
      tourHighlightedNodeIds: sorted[step].nodeIds,
      ...layerNav,
      ...layerResetIfChanged(layerNav, activeLayerId),
    });
  },

  nextTourStep: () => {
    const { graph, currentTourStep, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    const sorted = getSortedTour(graph);
    if (currentTourStep < sorted.length - 1) {
      const next = currentTourStep + 1;
      const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[next].nodeIds);
      set({
        currentTourStep: next,
        tourHighlightedNodeIds: sorted[next].nodeIds,
        ...layerNav,
        ...layerResetIfChanged(layerNav, activeLayerId),
      });
    }
  },

  prevTourStep: () => {
    const { graph, currentTourStep, nodeIdToLayerId, activeLayerId } = get();
    if (!graph || !graph.tour || graph.tour.length === 0) return;
    if (currentTourStep > 0) {
      const sorted = getSortedTour(graph);
      const prev = currentTourStep - 1;
      const layerNav = navigateTourToLayer(nodeIdToLayerId, sorted[prev].nodeIds);
      set({
        currentTourStep: prev,
        tourHighlightedNodeIds: sorted[prev].nodeIds,
        ...layerNav,
        ...layerResetIfChanged(layerNav, activeLayerId),
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
  startTraceAt: (id) =>
    set({
      traceRoot: id,
      traceStack: [id],
      tracePathTarget: null,
      viewMode: "trace",
      selectedNodeId: id,
      symbolPaletteOpen: false,
    }),

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
    set({ domainGraph: graph });
  },

  setIsKnowledgeGraph: (value) => {
    set({ isKnowledgeGraph: value });
  },

  setViewMode: (mode) => {
    set({
      viewMode: mode,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
      codeViewerExpanded: false,
    });
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
    });
  },

  clearActiveDomain: () => {
    set({
      activeDomainId: null,
      selectedNodeId: null,
      focusNodeId: null,
    });
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


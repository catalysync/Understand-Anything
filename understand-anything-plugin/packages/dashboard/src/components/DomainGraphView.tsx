import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import DomainClusterNode from "./DomainClusterNode";
import type { DomainClusterFlowNode } from "./DomainClusterNode";
import FlowNode from "./FlowNode";
import type { FlowFlowNode } from "./FlowNode";
import StepNode from "./StepNode";
import type { StepFlowNode } from "./StepNode";
import CrossDomainEdge from "./CrossDomainEdge";
import DomainBreadcrumb from "./DomainBreadcrumb";
import DomainToolbar from "./DomainToolbar";
import EntityGlossaryPanel from "./EntityGlossaryPanel";
import { useDashboardStore } from "../store";
import { mergeElkPositions, nodesToElkInput } from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import {
  flowsForDomain,
  longestCrossDomainChain,
  edgeBetween,
  domainDegrees,
  flowCountByDomain,
  nodesTouchingEntity,
  flowEntryTypes,
  normalizeEntryType,
  ENTRY_TYPE_COLOR,
} from "../utils/domainHelpers";
import type { KnowledgeGraph, GraphNode } from "@understand-anything/core/types";

/** Bundle of the active domain-view filters threaded into the build fns. */
interface DomainViewOpts {
  /** Item 119: hide domains with fewer than this many flows. */
  minFlows: number;
  /** Item 117: restrict to flows of this entry-type (null = all). */
  entryTypeFilter: string | null;
  /** Item 114: highlight nodes touching this entity, dim the rest (null = off). */
  entityFilter: string | null;
  /** Item 103: storyline playback — id of the currently-highlighted hop. */
  storyActiveDomainId: string | null;
  /** Item 130: persona-scoped rendering depth ("flow" hides step detail). */
  depth: "step" | "flow";
}

const nodeTypes = {
  "domain-cluster": DomainClusterNode,
  "flow-node": FlowNode,
  "step-node": StepNode,
};

const edgeTypes = {
  "cross-domain": CrossDomainEdge,
};

function getDomainMeta(node: GraphNode) {
  return node.domainMeta;
}

interface BuiltGraph {
  nodes: Node[];
  edges: Edge[];
  dims: Map<string, { width: number; height: number }>;
  /** When set, positions are final (manual layout); skip ELK. */
  preLaidOut?: boolean;
}

/** Build the overview using custom cross-domain edges (features 100/101). */
function buildDomainOverview(
  graph: KnowledgeGraph,
  opts: DomainViewOpts,
): BuiltGraph {
  const dims = new Map<string, { width: number; height: number }>();
  const flowCountMap = flowCountByDomain(graph); // item 119
  const degrees = domainDegrees(graph); // item 104

  // Item 119: drop trivial domains below the min-flows threshold.
  const domainNodes = graph.nodes.filter(
    (n) =>
      n.type === "domain" &&
      (flowCountMap.get(n.id) ?? 0) >= opts.minFlows,
  );
  const visibleIds = new Set(domainNodes.map((n) => n.id));

  // Item 117: which domains own at least one flow of the selected entry-type?
  let domainsWithEntryType: Set<string> | null = null;
  if (opts.entryTypeFilter) {
    const fet = flowEntryTypes(graph);
    const flowToDomain = new Map<string, string>();
    for (const e of graph.edges)
      if (e.type === "contains_flow") flowToDomain.set(e.target, e.source);
    domainsWithEntryType = new Set<string>();
    for (const [flowId, et] of fet) {
      if (et === opts.entryTypeFilter) {
        const dom = flowToDomain.get(flowId);
        if (dom) domainsWithEntryType.add(dom);
      }
    }
  }

  const rfNodes: DomainClusterFlowNode[] = domainNodes.map((node) => {
    const meta = getDomainMeta(node);
    const deg = degrees.get(node.id);
    dims.set(node.id, { width: 320, height: 180 });
    const storyActive = opts.storyActiveDomainId === node.id;
    // Item 117 dim: domains lacking the selected entry-type fade.
    const entryDimmed =
      !!domainsWithEntryType && !domainsWithEntryType.has(node.id);
    // Item 103 dim: when a story hop is active, the others fade.
    const storyDimmed =
      !!opts.storyActiveDomainId && opts.storyActiveDomainId !== node.id;
    return {
      id: node.id,
      type: "domain-cluster" as const,
      position: { x: 0, y: 0 },
      data: {
        label: node.name,
        summary: node.summary,
        entities: meta?.entities as string[] | undefined,
        flowCount: flowCountMap.get(node.id) ?? 0,
        businessRules: meta?.businessRules as string[] | undefined,
        domainId: node.id,
        isEntry: deg?.isEntry,
        isTerminal: deg?.isTerminal,
        storyActive,
        dimmed: entryDimmed || storyDimmed,
      },
    };
  });

  const rfEdges: Edge[] = graph.edges
    .filter(
      (e) =>
        e.type === "cross_domain" &&
        visibleIds.has(e.source) &&
        visibleIds.has(e.target),
    )
    .map((e, i) => ({
      id: `cd-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "cross-domain" as const,
      data: {
        description: e.description,
        weight: e.weight,
        direction: e.direction,
        label: e.description ?? "",
      },
    }));

  return { nodes: rfNodes as unknown as Node[], edges: rfEdges, dims };
}

/**
 * Feature 99: storyline — linearize the longest cross_domain chain into one
 * end-to-end ribbon (domains laid left→right in chain order).
 */
function buildStoryline(
  graph: KnowledgeGraph,
  playIndex: number,
): BuiltGraph {
  const chain = longestCrossDomainChain(graph);
  const dims = new Map<string, { width: number; height: number }>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const W = 320;
  const GAP = 140;
  const rfNodes: DomainClusterFlowNode[] = [];
  const flowCountMap = flowCountByDomain(graph);
  const degrees = domainDegrees(graph);
  // Item 103: during playback, the active hop is highlighted, others dimmed.
  const playing = playIndex >= 0;

  chain.forEach((domainId, i) => {
    const node = byId.get(domainId);
    if (!node) return;
    const meta = getDomainMeta(node);
    const deg = degrees.get(domainId);
    dims.set(domainId, { width: W, height: 180 });
    rfNodes.push({
      id: domainId,
      type: "domain-cluster" as const,
      position: { x: i * (W + GAP), y: 0 },
      data: {
        label: node.name,
        summary: node.summary,
        entities: meta?.entities as string[] | undefined,
        flowCount: flowCountMap.get(domainId) ?? 0,
        businessRules: meta?.businessRules as string[] | undefined,
        domainId,
        isEntry: deg?.isEntry,
        isTerminal: deg?.isTerminal,
        storyActive: playing && i === playIndex,
        dimmed: playing && i !== playIndex,
      },
    });
  });

  const rfEdges: Edge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const e = edgeBetween(graph, chain[i], chain[i + 1]);
    // Item 103: emphasise the edge leading into the active hop.
    const isActiveHop = playing && i === playIndex - 1;
    rfEdges.push({
      id: `story-${i}`,
      source: chain[i],
      target: chain[i + 1],
      type: "cross-domain" as const,
      data: {
        description: e?.description,
        weight: e?.weight ?? 0.8,
        direction: e?.direction ?? "forward",
        label: e?.description ?? "",
        emphasized: true,
        dimmed: playing && !isActiveHop,
      },
    });
  }

  return {
    nodes: rfNodes as unknown as Node[],
    edges: rfEdges,
    dims,
    preLaidOut: true,
  };
}

/**
 * Feature 95: swim-lane detail layout. Each flow is its own horizontal lane —
 * the flow header sits at the left, its steps flow right in order. Feature 93:
 * when a flow is focused, the other lanes (and their steps) are dimmed.
 */
function buildDomainDetailSwimlanes(
  graph: KnowledgeGraph,
  domainId: string,
  focusedFlowId: string | null,
  opts: DomainViewOpts,
): BuiltGraph {
  const flows = flowsForDomain(graph, domainId);
  const dims = new Map<string, { width: number; height: number }>();
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];

  // Item 114: entity highlight set (flow/step ids touching the active entity).
  const entityHits = opts.entityFilter
    ? nodesTouchingEntity(graph, opts.entityFilter)
    : null;
  // Item 130: non-technical persona hides step-level detail.
  const showSteps = opts.depth === "step";

  const FLOW_W = 260;
  const FLOW_H = 120;
  const STEP_W = 210;
  const STEP_H = 100;
  const STEP_GAP_X = 60;
  const LANE_GAP_Y = 60;
  const HEADER_GAP_X = 80;

  let y = 0;
  for (const { flow, steps } of flows) {
    const dimmed = focusedFlowId !== null && focusedFlowId !== flow.id;
    const focused = focusedFlowId === flow.id;
    // Item 114: a flow is entity-dimmed when a filter is active and it (and
    // none of its steps) touches the entity.
    const flowTouches = entityHits ? entityHits.has(flow.id) : true;
    const anyStepTouches = entityHits
      ? steps.some((s) => entityHits.has(s.node.id))
      : true;
    const flowEntityDimmed = !!entityHits && !flowTouches && !anyStepTouches;
    // Item 117: entry-type accent stripe on the flow card.
    const et = normalizeEntryType(flow.domainMeta?.entryType);
    const entryTypeColor = et === "other" ? undefined : ENTRY_TYPE_COLOR[et];
    dims.set(flow.id, { width: FLOW_W, height: FLOW_H });
    const laneHeight = Math.max(FLOW_H, STEP_H);
    const flowY = y + (laneHeight - FLOW_H) / 2;

    rfNodes.push({
      id: flow.id,
      type: "flow-node",
      position: { x: 0, y: flowY },
      data: {
        label: flow.name,
        summary: flow.summary,
        entryPoint: flow.domainMeta?.entryPoint as string | undefined,
        entryType: flow.domainMeta?.entryType as string | undefined,
        stepCount: steps.length,
        flowId: flow.id,
        dimmed,
        focused,
        entityDimmed: flowEntityDimmed,
        entryTypeColor,
      },
    } as FlowFlowNode as unknown as Node);

    // Item 130: non-technical persona renders flows only (no step lane).
    if (showSteps) {
      const stepY = y + (laneHeight - STEP_H) / 2;
      steps.forEach((s, idx) => {
        const x = FLOW_W + HEADER_GAP_X + idx * (STEP_W + STEP_GAP_X);
        const stepEntityDimmed = entityHits
          ? !entityHits.has(s.node.id) && !flowTouches
          : false;
        dims.set(s.node.id, { width: STEP_W, height: STEP_H });
        rfNodes.push({
          id: s.node.id,
          type: "step-node",
          position: { x, y: stepY },
          data: {
            label: s.node.name,
            summary: s.node.summary,
            filePath: s.node.filePath,
            stepId: s.node.id,
            order: idx + 1,
            dimmed,
            entityDimmed: stepEntityDimmed,
          },
        } as StepFlowNode as unknown as Node);

        const prevId = idx === 0 ? flow.id : steps[idx - 1].node.id;
        rfEdges.push({
          id: `fs-${flow.id}-${idx}`,
          source: prevId,
          target: s.node.id,
          style: {
            stroke: dimmed
              ? "var(--color-border-subtle)"
              : "var(--color-border-medium)",
            strokeWidth: 1.5,
            opacity: dimmed || flowEntityDimmed ? 0.3 : 1,
          },
          animated: false,
        });
      });
    }

    y += laneHeight + LANE_GAP_Y;
  }

  return { nodes: rfNodes, edges: rfEdges, dims, preLaidOut: true };
}

/**
 * Item 103: "Play the storyline" control bar — a timed walk along the longest
 * cross-domain chain with play/pause/prev/next, showing each hop's domain name
 * and the cross-domain description of the edge leading into it.
 */
function StorylinePlaybackBar({
  chain,
  graph,
}: {
  chain: string[];
  graph: KnowledgeGraph;
}) {
  const playIndex = useDashboardStore((s) => s.storylinePlayIndex);
  const playing = useDashboardStore((s) => s.storylinePlaying);
  const start = useDashboardStore((s) => s.startStorylinePlay);
  const pause = useDashboardStore((s) => s.pauseStorylinePlay);
  const step = useDashboardStore((s) => s.stepStorylinePlay);
  const stop = useDashboardStore((s) => s.stopStorylinePlay);

  const byId = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n] as const)),
    [graph],
  );
  const idx = playIndex < 0 ? 0 : Math.min(playIndex, chain.length - 1);
  const activeDomain = byId.get(chain[idx]);
  const hopEdge =
    idx > 0 ? edgeBetween(graph, chain[idx - 1], chain[idx]) : undefined;
  const atStart = idx <= 0;
  const atEnd = idx >= chain.length - 1;
  const active = playIndex >= 0;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(560px,90%)] rounded-xl bg-surface/95 border border-border-medium shadow-2xl px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={!active || atStart}
            title="Previous hop"
            className="w-7 h-7 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-accent disabled:opacity-30 transition-colors"
          >
            ‹
          </button>
          {playing ? (
            <button
              type="button"
              onClick={() => pause()}
              title="Pause"
              className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/50 text-accent transition-colors"
            >
              ❚❚
            </button>
          ) : (
            <button
              type="button"
              onClick={() => start()}
              title="Play the storyline"
              className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/50 text-accent transition-colors"
            >
              ▶
            </button>
          )}
          <button
            type="button"
            onClick={() => step(1)}
            disabled={atEnd}
            title="Next hop"
            className="w-7 h-7 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-accent disabled:opacity-30 transition-colors"
          >
            ›
          </button>
          {active && (
            <button
              type="button"
              onClick={() => stop()}
              title="Stop and reset"
              className="w-7 h-7 rounded-lg bg-elevated border border-border-subtle text-text-muted hover:text-[#c97070] transition-colors"
            >
              ■
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-text-muted shrink-0">
              {idx + 1}/{chain.length}
            </span>
            <span className="text-sm font-semibold text-accent truncate">
              {activeDomain?.name ?? "—"}
            </span>
          </div>
          <div className="text-[11px] text-text-secondary leading-snug line-clamp-2">
            {hopEdge?.description
              ? hopEdge.description
              : idx === 0
                ? "Start of the business storyline."
                : "Continues the cross-domain path."}
          </div>
        </div>
      </div>

      {/* Progress rail */}
      <div className="mt-2 h-1 rounded-full bg-elevated overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{
            width: `${chain.length > 1 ? (idx / (chain.length - 1)) * 100 : 100}%`,
          }}
        />
      </div>
    </div>
  );
}

function DomainGraphViewInner() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const focusedFlowId = useDashboardStore((s) => s.focusedFlowId);
  const setFocusedFlow = useDashboardStore((s) => s.setFocusedFlow);
  const storyline = useDashboardStore((s) => s.domainStorylineMode);
  // 200-series domain polish.
  const persona = useDashboardStore((s) => s.persona); // item 130
  const minFlows = useDashboardStore((s) => s.domainMinFlows); // item 119
  const entryTypeFilter = useDashboardStore((s) => s.domainEntryTypeFilter); // item 117
  const entityFilter = useDashboardStore((s) => s.domainEntityFilter); // item 114
  const playIndex = useDashboardStore((s) => s.storylinePlayIndex); // item 103
  const playing = useDashboardStore((s) => s.storylinePlaying); // item 103
  const stepStorylinePlay = useDashboardStore((s) => s.stepStorylinePlay);
  const pauseStorylinePlay = useDashboardStore((s) => s.pauseStorylinePlay);

  // Item 103: the chain (for playback bounds + the active hop's domain id).
  const chain = useMemo(
    () => (domainGraph ? longestCrossDomainChain(domainGraph) : []),
    [domainGraph],
  );
  const storyActiveDomainId =
    playIndex >= 0 && playIndex < chain.length ? chain[playIndex] : null;

  // Item 103: timed auto-advance while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (playIndex >= chain.length - 1) {
      // Reached the end — stop auto-advancing but keep the last hop lit.
      pauseStorylinePlay();
      return;
    }
    const t = setTimeout(() => stepStorylinePlay(1), 2600);
    return () => clearTimeout(t);
  }, [playing, playIndex, chain.length, stepStorylinePlay, pauseStorylinePlay]);

  // Item 130: persona maps to render depth — non-technical sees flows only.
  const depth: "step" | "flow" =
    persona === "non-technical" ? "flow" : "step";

  const opts = useMemo<DomainViewOpts>(
    () => ({
      minFlows,
      entryTypeFilter,
      entityFilter,
      storyActiveDomainId,
      depth,
    }),
    [minFlows, entryTypeFilter, entityFilter, storyActiveDomainId, depth],
  );

  const built = useMemo<BuiltGraph | null>(() => {
    if (!domainGraph) return null;
    if (activeDomainId) {
      return buildDomainDetailSwimlanes(
        domainGraph,
        activeDomainId,
        focusedFlowId,
        opts,
      );
    }
    if (storyline) return buildStoryline(domainGraph, playIndex);
    return buildDomainOverview(domainGraph, opts);
  }, [domainGraph, activeDomainId, focusedFlowId, storyline, opts, playIndex]);

  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] }>({
    nodes: [],
    edges: [],
  });

  useEffect(() => {
    if (!built) {
      setLayout({ nodes: [], edges: [] });
      return;
    }
    const { nodes: nodesArray, edges: edgesArray, dims, preLaidOut } = built;
    // Swim-lane + storyline are manually positioned — skip ELK.
    if (preLaidOut) {
      setLayout({ nodes: nodesArray, edges: edgesArray });
      return;
    }
    let cancelled = false;
    const elkInput = nodesToElkInput(nodesArray, edgesArray, dims, {
      "elk.direction": "RIGHT",
    });
    applyElkLayout(elkInput, { strict: import.meta.env.DEV })
      .then(({ positioned, issues }) => {
        if (cancelled) return;
        if (issues.length > 0) {
          useDashboardStore.getState().appendLayoutIssues(issues);
        }
        setLayout({
          nodes: mergeElkPositions(nodesArray, positioned),
          edges: edgesArray,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[domain ELK] layout failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [built]);

  const { nodes, edges } = layout;

  if (!domainGraph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No domain graph available. Run /understand-domain to generate one.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <DomainBreadcrumb />
      <DomainToolbar />
      <EntityGlossaryPanel />

      {/* Feature 93: clear focus-a-flow */}
      {activeDomainId && focusedFlowId && (
        <div className="absolute top-16 left-3 z-10">
          <button
            type="button"
            onClick={() => setFocusedFlow(null)}
            className="px-3 py-1.5 text-xs rounded-lg bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors"
          >
            ✕ Clear flow focus
          </button>
        </div>
      )}

      {/* Item 114: clear the active entity highlight (domain-detail view). */}
      {activeDomainId && entityFilter && (
        <div className="absolute top-16 left-3 z-10">
          <button
            type="button"
            onClick={() =>
              useDashboardStore.getState().setDomainEntityFilter(null)
            }
            className="px-3 py-1.5 text-xs rounded-lg bg-node-entity/15 border border-node-entity/40 text-node-entity hover:bg-node-entity/25 transition-colors"
          >
            ✕ Entity: {entityFilter}
          </button>
        </div>
      )}

      {/* Item 103: storyline playback control bar (overview/storyline only). */}
      {!activeDomainId && storyline && chain.length >= 2 && (
        <StorylinePlaybackBar chain={chain} graph={domainGraph} />
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => {
          if (focusedFlowId) setFocusedFlow(null);
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border-subtle)"
        />
        <Controls />
        <MiniMap
          nodeColor="var(--color-accent)"
          maskColor="var(--glass-bg)"
          className="!bg-surface !border !border-border-subtle"
        />
      </ReactFlow>
    </div>
  );
}

export default function DomainGraphView() {
  return (
    <ReactFlowProvider>
      <DomainGraphViewInner />
    </ReactFlowProvider>
  );
}

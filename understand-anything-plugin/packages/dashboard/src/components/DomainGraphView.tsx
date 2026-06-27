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
import { useDashboardStore } from "../store";
import { mergeElkPositions, nodesToElkInput } from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import {
  flowsForDomain,
  longestCrossDomainChain,
  edgeBetween,
} from "../utils/domainHelpers";
import type { KnowledgeGraph, GraphNode } from "@understand-anything/core/types";

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
function buildDomainOverview(graph: KnowledgeGraph): BuiltGraph {
  const dims = new Map<string, { width: number; height: number }>();
  const domainNodes = graph.nodes.filter((n) => n.type === "domain");

  const flowCountMap = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "contains_flow") {
      flowCountMap.set(edge.source, (flowCountMap.get(edge.source) ?? 0) + 1);
    }
  }

  const rfNodes: DomainClusterFlowNode[] = domainNodes.map((node) => {
    const meta = getDomainMeta(node);
    dims.set(node.id, { width: 320, height: 180 });
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
      },
    };
  });

  const rfEdges: Edge[] = graph.edges
    .filter((e) => e.type === "cross_domain")
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
function buildStoryline(graph: KnowledgeGraph): BuiltGraph {
  const chain = longestCrossDomainChain(graph);
  const dims = new Map<string, { width: number; height: number }>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const W = 320;
  const GAP = 140;
  const rfNodes: DomainClusterFlowNode[] = [];

  const flowCountMap = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "contains_flow")
      flowCountMap.set(edge.source, (flowCountMap.get(edge.source) ?? 0) + 1);
  }

  chain.forEach((domainId, i) => {
    const node = byId.get(domainId);
    if (!node) return;
    const meta = getDomainMeta(node);
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
      },
    });
  });

  const rfEdges: Edge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const e = edgeBetween(graph, chain[i], chain[i + 1]);
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
): BuiltGraph {
  const flows = flowsForDomain(graph, domainId);
  const dims = new Map<string, { width: number; height: number }>();
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];

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
      },
    } as FlowFlowNode as unknown as Node);

    const stepY = y + (laneHeight - STEP_H) / 2;
    steps.forEach((s, idx) => {
      const x = FLOW_W + HEADER_GAP_X + idx * (STEP_W + STEP_GAP_X);
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
          opacity: dimmed ? 0.3 : 1,
        },
        animated: false,
      });
    });

    y += laneHeight + LANE_GAP_Y;
  }

  return { nodes: rfNodes, edges: rfEdges, dims, preLaidOut: true };
}

function DomainGraphViewInner() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const focusedFlowId = useDashboardStore((s) => s.focusedFlowId);
  const setFocusedFlow = useDashboardStore((s) => s.setFocusedFlow);
  const storyline = useDashboardStore((s) => s.domainStorylineMode);

  const built = useMemo<BuiltGraph | null>(() => {
    if (!domainGraph) return null;
    if (activeDomainId) {
      return buildDomainDetailSwimlanes(
        domainGraph,
        activeDomainId,
        focusedFlowId,
      );
    }
    if (storyline) return buildStoryline(domainGraph);
    return buildDomainOverview(domainGraph);
  }, [domainGraph, activeDomainId, focusedFlowId, storyline]);

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

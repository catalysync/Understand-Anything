import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import type { NodeType } from "@understand-anything/core/types";
import { useI18n } from "../contexts/I18nContext";

// Color maps keyed by NodeType — must be kept in sync with core NodeType union.
const typeColors: Record<NodeType, string> = {
  file: "var(--color-node-file)",
  function: "var(--color-node-function)",
  class: "var(--color-node-class)",
  module: "var(--color-node-module)",
  concept: "var(--color-node-concept)",
  config: "var(--color-node-config)",
  document: "var(--color-node-document)",
  service: "var(--color-node-service)",
  table: "var(--color-node-table)",
  endpoint: "var(--color-node-endpoint)",
  pipeline: "var(--color-node-pipeline)",
  schema: "var(--color-node-schema)",
  resource: "var(--color-node-resource)",
  domain: "var(--color-node-concept)",
  flow: "var(--color-node-pipeline)",
  step: "var(--color-node-function)",
  article: "var(--color-node-article)",
  entity: "var(--color-node-entity)",
  topic: "var(--color-node-topic)",
  claim: "var(--color-node-claim)",
  source: "var(--color-node-source)",
  // ── Operations layer (300-series) — semantically grouped hues ──────────
  // entrypoints → warm orange/amber (share the endpoint hue)
  route: "var(--color-node-endpoint)",
  command: "var(--color-node-endpoint)",
  event: "var(--color-node-endpoint)",
  schedule: "var(--color-node-endpoint)",
  api: "var(--color-node-endpoint)",
  // data → teal/cyan (share the table hue)
  column: "var(--color-node-table)",
  model: "var(--color-node-table)",
  query: "var(--color-node-table)",
  transaction: "var(--color-node-table)",
  migration: "var(--color-node-table)",
  cache_key: "var(--color-node-table)",
  payload_schema: "var(--color-node-table)",
  // tests/coverage → green (share the function hue)
  test: "var(--color-node-test)",
  suite: "var(--color-node-test)",
  fixture: "var(--color-node-test)",
  finding: "var(--color-node-finding)",
  // errors → red/crimson
  error_type: "var(--color-node-error)",
  // config/flags/secrets → yellow/gold
  env_var: "var(--color-node-config-ops)",
  feature_flag: "var(--color-node-config-ops)",
  secret: "var(--color-node-config-ops)",
  // observability → violet
  log_site: "var(--color-node-observability)",
  span_site: "var(--color-node-observability)",
  metric: "var(--color-node-observability)",
  alert: "var(--color-node-observability)",
  // ownership → slate; docs → document hue
  owner: "var(--color-node-owner)",
  doc: "var(--color-node-document)",
};

const typeTextColors: Record<NodeType, string> = {
  file: "text-node-file",
  function: "text-node-function",
  class: "text-node-class",
  module: "text-node-module",
  concept: "text-node-concept",
  config: "text-node-config",
  document: "text-node-document",
  service: "text-node-service",
  table: "text-node-table",
  endpoint: "text-node-endpoint",
  pipeline: "text-node-pipeline",
  schema: "text-node-schema",
  resource: "text-node-resource",
  domain: "text-node-concept",
  flow: "text-node-pipeline",
  step: "text-node-function",
  article: "text-node-article",
  entity: "text-node-entity",
  topic: "text-node-topic",
  claim: "text-node-claim",
  source: "text-node-source",
  // ── Operations layer (300-series) ──────────────────────────────────────
  route: "text-node-endpoint",
  command: "text-node-endpoint",
  event: "text-node-endpoint",
  schedule: "text-node-endpoint",
  api: "text-node-endpoint",
  column: "text-node-table",
  model: "text-node-table",
  query: "text-node-table",
  transaction: "text-node-table",
  migration: "text-node-table",
  cache_key: "text-node-table",
  payload_schema: "text-node-table",
  test: "text-node-test",
  suite: "text-node-test",
  fixture: "text-node-test",
  finding: "text-node-finding",
  error_type: "text-node-error",
  env_var: "text-node-config-ops",
  feature_flag: "text-node-config-ops",
  secret: "text-node-config-ops",
  log_site: "text-node-observability",
  span_site: "text-node-observability",
  metric: "text-node-observability",
  alert: "text-node-observability",
  owner: "text-node-owner",
  doc: "text-node-document",
};

const complexityColors: Record<string, string> = {
  simple: "text-node-function",
  moderate: "text-accent-dim",
  complex: "text-[#c97070]",
};

// Item 83: complexity heat overlay — green → amber → red left-bar color.
const complexityHeatColors: Record<string, string> = {
  simple: "#5a9e6f",
  moderate: "#d4a574",
  complex: "#c97070",
};

export interface CustomNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  summary: string;
  complexity: string;
  isHighlighted: boolean;
  searchScore?: number;
  isSelected: boolean;
  isTourHighlighted: boolean;
  isDiffChanged: boolean;
  isDiffAffected: boolean;
  isDiffFaded: boolean;
  isNeighbor: boolean;
  isSelectionFaded: boolean;
  onNodeClick?: (nodeId: string) => void;
  incomingCount?: number;
  outgoingCount?: number;
  tags?: string[];
  /** Item 55: level-of-detail — "dot" / "name" / "full" set from viewport zoom. */
  lod?: "dot" | "name" | "full";
  /** Item 83: recolor the left bar by complexity (green→amber→red). */
  heat?: boolean;
  /** 300-series item 39: tri-state coverage overlay state for this node. */
  coverage?: "covered" | "partial" | "uncovered" | null;
  /** 300-series item 40: covering-test count (drives the "N tests" badge). */
  coverageTestCount?: number;
  /** 300-series item 45: node is in the impacted-test highlight set. */
  isTestImpacted?: boolean;
  /** 300-series item 99/101-102: instrumentation heat tri-state. */
  instrumentation?: "instrumented" | "auto" | "dark" | null;
  /** 300-series item 95: node swallows an error (warning glyph). */
  isSwallowed?: boolean;
  /** 300-series items 92-94: error-propagation highlight roles. */
  errRole?: "raise" | "path" | "handler" | null;
  /** 300-series item 51: ownership overlay fill (owner-hue OR single-owner flag). */
  ownerColor?: string | null;
  /** 300-series item 51: single-owner complex hotspot flag (single-owner mode). */
  isSingleOwner?: boolean;
  /** 300-series item 117: churn-risk ("suspect commit") — high churn + raises. */
  isChurnRisk?: boolean;
  /** 300-series item 27: node participates in an import cycle. */
  isInCycle?: boolean;
  /** 300-series item 21: node is part of the public API surface (badged). */
  isPublic?: boolean;
  /** 200-series item 87: freshness ratio (1=just changed..0=window edge); null=not recent. */
  staleRatio?: number | null;
}

// 300-series item 39: tri-state coverage palette (green / amber / red).
const coverageColors: Record<string, string> = {
  covered: "#5a9e6f",
  partial: "#d4a574",
  uncovered: "#c97070",
};

// 300-series item 99/101-102: instrumentation heat palette.
const instrumentationColors: Record<string, string> = {
  instrumented: "#5a9e6f", // green — emits telemetry
  auto: "#d4a574",         // amber — reachable but telemetry-less
  dark: "#c97070",         // red — telemetry-dark
};

export type CustomFlowNode = Node<CustomNodeData, "custom">;

function CustomNodeComponent({
  id,
  data,
}: NodeProps<CustomFlowNode>) {
  const knownType = data.nodeType as NodeType;
  const coverageColor =
    data.coverage != null ? coverageColors[data.coverage] : undefined;
  const instrColor =
    data.instrumentation != null ? instrumentationColors[data.instrumentation] : undefined;
  const barColor = coverageColor
    ? coverageColor
    : instrColor
      ? instrColor
      : data.ownerColor
        ? data.ownerColor
        : data.heat
          ? complexityHeatColors[data.complexity] ?? complexityHeatColors.simple
          : typeColors[knownType] ?? typeColors.file;
  const textColor = typeTextColors[knownType] ?? typeTextColors.file;
  const complexityColor = complexityColors[data.complexity] ?? complexityColors.simple;
  const lod = data.lod ?? "full";
  const { t } = useI18n();

  if (import.meta.env.DEV && !(knownType in typeColors)) {
    console.warn(`[CustomNode] Unknown node type "${data.nodeType}" — using "file" colors`);
  }

  let extraClass = "";
  if (data.isSelected) {
    extraClass = "ring-2 ring-accent node-glow";
  } else if (data.isTourHighlighted) {
    extraClass = "ring-2 ring-accent-dim animate-accent-pulse";
  } else if (data.isHighlighted) {
    const score = data.searchScore ?? 1;
    if (score <= 0.1) {
      extraClass = "ring-2 ring-accent-bright";
    } else if (score <= 0.3) {
      extraClass = "ring-2 ring-accent";
    } else {
      extraClass = "ring-1 ring-accent-dim/60";
    }
  }

  // Diff overlay styling (composes with above)
  if (data.isDiffChanged) {
    extraClass += " ring-2 ring-[var(--color-diff-changed)] diff-changed-glow";
  } else if (data.isDiffAffected) {
    extraClass += " ring-1 ring-[var(--color-diff-affected)] diff-affected-glow";
  } else if (data.isDiffFaded) {
    extraClass += " diff-faded";
  }

  // Selection-based dimming (when another node is selected, fade unrelated nodes)
  if (data.isSelectionFaded) {
    extraClass += " opacity-20 pointer-events-auto";
  } else if (data.isNeighbor) {
    extraClass += " ring-1 ring-gold-dim/50";
  }

  // 300-series item 45: impacted-test highlight (amber pulse ring).
  if (data.isTestImpacted) {
    extraClass += " ring-2 ring-[#d4a574] animate-accent-pulse";
  }

  // 300-series items 92-94: error-propagation roles. Raise = crimson glow,
  // handler = green ring (terminates), path = dim crimson ring.
  if (data.errRole === "raise") {
    extraClass += " ring-2 ring-[#d35d6e] animate-accent-pulse";
  } else if (data.errRole === "handler") {
    extraClass += " ring-2 ring-[#5a9e6f]";
  } else if (data.errRole === "path") {
    extraClass += " ring-1 ring-[#d35d6e]/50";
  }

  // 300-series item 27: import-cycle members ring in red.
  if (data.isInCycle) {
    extraClass += " ring-2 ring-[#d35d6e]";
  }
  // 300-series item 51: single-owner complex hotspot flag (amber dashed ring).
  if (data.isSingleOwner) {
    extraClass += " ring-2 ring-[#d4a574]/70";
  }

  const name = data.label ?? "unnamed";
  const truncatedName =
    name.length > 24 ? name.slice(0, 22) + "..." : name;

  // Item 55: level-of-detail. When zoomed far out, render a compact dot or
  // name-only chip so 5k nodes stay legible and cheap to paint. Handles
  // (target/source) are kept so edges still attach.
  if (lod === "dot") {
    return (
      <div
        className={`relative rounded-full ${extraClass} cursor-pointer`}
        style={{ width: 16, height: 16, backgroundColor: barColor, boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }}
        title={name}
        onClick={() => data.onNodeClick?.(id)}
      >
        <Handle type="target" position={Position.Top} className="!opacity-0 !w-1 !h-1" />
        <Handle type="source" position={Position.Bottom} className="!opacity-0 !w-1 !h-1" />
      </div>
    );
  }

  if (lod === "name") {
    return (
      <div
        className={`relative flex items-center gap-1.5 rounded-md bg-elevated border border-border-subtle ${extraClass} px-2 py-1 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.3)] max-w-[200px]`}
        title={name}
        onClick={() => data.onNodeClick?.(id)}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: barColor }} />
        <span className="text-[11px] font-heading text-text-primary truncate">{truncatedName}</span>
        <Handle type="target" position={Position.Top} className="!bg-text-muted !w-2 !h-2" />
        <Handle type="source" position={Position.Bottom} className="!bg-text-muted !w-2 !h-2" />
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-lg bg-elevated border border-border-subtle ${extraClass} min-w-[180px] max-w-[220px] overflow-hidden transition-[box-shadow,outline,opacity,filter] duration-200 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.3)]`}
      onClick={() => data.onNodeClick?.(id)}
    >
      {/* Left color bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{ backgroundColor: barColor }}
      />

      <Handle
        type="target"
        position={Position.Top}
        className="!bg-text-muted !w-2 !h-2"
      />

      <div className="pl-4 pr-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${textColor}`}>
            {data.nodeType}
          </span>
          <div className="flex items-center gap-1.5">
            {data.staleRatio != null && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: "#5a9e6f",
                  // Fresher → more opaque dot (subtle age tint).
                  opacity: 0.35 + 0.6 * data.staleRatio,
                  boxShadow: "0 0 4px rgba(90,158,111,0.5)",
                }}
                role="img"
                aria-label="Recently changed"
                title="Recently changed (git)"
              />
            )}
            {data.isPublic && (
              <span
                className="text-[8px] font-bold uppercase px-1 rounded bg-[#7da7d4]/15 text-[#7da7d4] leading-none"
                role="img"
                aria-label="Public API surface"
                title="Public — exported or referenced across a layer/file boundary"
              >
                pub
              </span>
            )}
            {data.isChurnRisk && (
              <span
                className="text-[8px] font-bold uppercase px-1 rounded bg-[#d35d6e]/15 text-[#d35d6e] leading-none"
                role="img"
                aria-label="Suspect commit — high churn and raises an error"
                title="Suspect commit — high churn AND raises an error (churn-risk)"
              >
                ⚠ churn
              </span>
            )}
            {data.isSwallowed && (
              <span
                className="text-[10px] leading-none text-[#d4a574]"
                role="img"
                aria-label="Swallows an error"
                title="Swallows an error (empty / log-only / broad catch)"
              >
                ⚠
              </span>
            )}
            <span className={`text-[9px] font-mono ${complexityColor}`}>
              {data.complexity}
            </span>
            {data.coverage != null && (data.coverageTestCount ?? 0) > 0 ? (
              <span
                className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0.5 rounded-full"
                style={{ color: coverageColors[data.coverage], backgroundColor: `${coverageColors[data.coverage]}22` }}
                title={`${data.coverageTestCount} test${data.coverageTestCount === 1 ? "" : "s"} cover this`}
              >
                ✓{data.coverageTestCount}
              </span>
            ) : data.tags?.includes("tested") ? (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-node-function shadow-[0_0_4px_rgba(90,158,111,0.6)]"
                role="img"
                aria-label={t.customNode.tested}
                title={t.customNode.hasTests}
              />
            ) : null}
          </div>
        </div>

        <div className="text-sm font-heading text-text-primary truncate" title={data.label}>
          {truncatedName}
        </div>

        <div className="text-[11px] text-text-secondary mt-1 line-clamp-2 leading-tight">
          {data.summary}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-text-muted !w-2 !h-2"
      />
    </div>
  );
}

const CustomNode = memo(CustomNodeComponent);
export default CustomNode;

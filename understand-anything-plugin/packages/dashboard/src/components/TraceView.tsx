import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import CodeBlock from "./CodeBlock";
import { useExplain } from "./useCodeAssist";
import ExplainPanel from "./ExplainPanel";
import TraceControls from "./TraceControls";
import {
  buildTrace,
  callTargets,
  callersOf,
  criticalPath as computeCriticalPath,
  pathBetween,
  bundleCalleesByPackage,
  packageOf,
  packageLabel,
  packagesIn,
  defaultMutedPackages,
  matchesFoldPattern,
  subtreeSize,
  referencesOf,
  implementationsOf,
  interfacesOf,
  containmentBreadcrumb,
  detectConcurrency,
  goroutineCallees,
} from "./traceGraph";
import ReferencesPanel from "./ReferencesPanel";
import HoverPopover, { type HoverTarget } from "./HoverPopover";
import {
  watchHitsInSource,
  findAssignmentInSlice,
  parseScope,
  parsePredicate,
  hopMatchesPredicate,
  detectErrorHandling,
  looksLikeErrorNode,
  heatValue,
  heatColor,
  controlFlowOutline,
  diffTraceIds,
  type DiffStatus,
} from "./traceDebug";
import { callCountOf } from "./traceGraph";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

interface TraceViewProps {
  accessToken: string;
}

interface SourceFile {
  path: string;
  language: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
}

type SourceState =
  | { status: "idle" | "loading"; source: null; error: null }
  | { status: "loaded"; source: SourceFile; error: null }
  | { status: "error"; source: null; error: string };

// Map a node type to one of the existing --color-node-* CSS vars.
function nodeColorVar(type: string): string {
  const known = new Set([
    "file", "function", "class", "module", "concept", "config", "document",
    "service", "table", "endpoint", "pipeline", "schema", "resource",
    "article", "entity", "topic", "claim", "source",
  ]);
  if (known.has(type)) return `var(--color-node-${type})`;
  if (type === "domain") return "var(--color-node-concept)";
  if (type === "step") return "var(--color-node-function)";
  if (type === "flow") return "var(--color-node-pipeline)";
  return "var(--color-node-file)";
}

function fileContentUrl(filePath: string, token: string): string {
  const params = new URLSearchParams({ token, path: filePath });
  return `/file-content.json?${params.toString()}`;
}

function fallbackLanguage(filePath: string | undefined): string {
  const ext = filePath?.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    css: "css", go: "go", html: "markup", js: "javascript", jsx: "jsx",
    json: "json", md: "markdown", py: "python", rb: "ruby", rs: "rust",
    sh: "bash", ts: "typescript", tsx: "tsx", yaml: "yaml", yml: "yaml",
  };
  return ext ? byExt[ext] ?? "text" : "text";
}

function lineLabel(node: GraphNode): string {
  if (!node.lineRange) return node.filePath ?? "—";
  return `${node.filePath ?? ""}:${node.lineRange[0]}–${node.lineRange[1]}`;
}

/**
 * Lift source-file fetching into a hook so HopCard can use the loaded source
 * for concurrency detection (feature 19) and inline peek (feature 16), while
 * HopCode renders the highlighted slice.
 */
function useHopSource(filePath: string | undefined, accessToken: string): SourceState {
  const [state, setState] = useState<SourceState>({
    status: "idle",
    source: null,
    error: null,
  });
  useEffect(() => {
    if (!filePath) {
      setState({ status: "error", source: null, error: "No file path for this node." });
      return;
    }
    if (accessToken === "__demo__") {
      setState({
        status: "error",
        source: null,
        error: "Source preview requires the local dashboard server.",
      });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", source: null, error: null });
    fetch(fileContentUrl(filePath, accessToken), { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json()) as SourceFile | { error?: string };
        if (!res.ok) {
          throw new Error("error" in data && data.error ? data.error : "Source unavailable");
        }
        setState({ status: "loaded", source: data as SourceFile, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          source: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => controller.abort();
  }, [accessToken, filePath]);
  return state;
}

/** Slice the lines [start,end] (1-based inclusive) out of full source. */
function sliceSource(content: string | undefined, range: { start: number; end: number } | null): string {
  if (!content || !range) return "";
  return content.split("\n").slice(Math.max(0, range.start - 1), range.end).join("\n");
}

function HopCode({
  node,
  accessToken,
  graph,
  pushTrace,
  state,
  inlayHints,
  onPeekNode,
  flashLine,
}: {
  node: GraphNode;
  accessToken: string;
  graph: KnowledgeGraph;
  pushTrace: (id: string) => void;
  state: SourceState;
  inlayHints: boolean;
  onPeekNode: (id: string) => void;
  flashLine?: number | null;
}) {
  const range = node.lineRange ? { start: node.lineRange[0], end: node.lineRange[1] } : null;
  const language = state.source?.language ?? fallbackLanguage(node.filePath);

  if (state.status === "loading") {
    return <div className="p-4 text-xs text-text-muted">Loading source…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="p-4 text-xs text-text-secondary">
        <span className="text-text-muted">Source unavailable:</span> {state.error}
      </div>
    );
  }
  const source = state.source;
  if (!source) return null;

  const windowStart = range ? Math.max(1, range.start - 8) : undefined;
  const windowEnd = range ? range.end + 12 : undefined;
  // Feature 22: when a "where set" jump is active, tighten the highlight to that
  // single line so the assignment stands out within the hop's source.
  const effectiveRange = flashLine != null ? { start: flashLine, end: flashLine } : range;

  return (
    <div className="max-h-[70vh] overflow-auto bg-root">
      {flashLine != null && (
        <div
          data-testid="where-set-flash"
          className="px-3 py-1.5 text-[11px] text-accent bg-accent/10 border-b border-accent/30 font-mono"
        >
          ↩ heuristic dataflow — assignment near line {flashLine} highlighted (regex, not SSA)
        </div>
      )}
      <CodeBlock
        code={source.content}
        language={language}
        accessToken={accessToken}
        filePath={node.filePath}
        highlightedRange={effectiveRange}
        windowStart={windowStart}
        windowEnd={windowEnd}
        graph={graph}
        currentNodeId={node.id}
        onJumpToNode={(targetId) => pushTrace(targetId)}
        onPeekNode={onPeekNode}
        inlayHints={inlayHints}
        fontSizeClass="text-[13px] leading-6"
      />
    </div>
  );
}

/** Inline peek (feature 16): render a callee's definition slice, collapsible. */
function PeekDefinition({
  node,
  accessToken,
  graph,
  onClose,
  onTrace,
}: {
  node: GraphNode;
  accessToken: string;
  graph: KnowledgeGraph;
  onClose: () => void;
  onTrace: (id: string) => void;
}) {
  const state = useHopSource(node.filePath, accessToken);
  const range = node.lineRange ? { start: node.lineRange[0], end: node.lineRange[1] } : null;
  const language = state.source?.language ?? fallbackLanguage(node.filePath);
  return (
    <div
      data-testid="peek-definition"
      className="rounded border border-accent/30 bg-root/60 overflow-hidden"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-accent/10 border-b border-accent/20">
        <span className="text-[10px] uppercase tracking-wider text-accent">Peek</span>
        <span className="text-[11px] font-mono text-text-primary truncate flex-1" title={lineLabel(node)}>
          {node.name} · {lineLabel(node)}
        </span>
        <button
          type="button"
          onClick={() => onTrace(node.id)}
          className="text-[10px] font-semibold text-accent hover:text-accent-bright shrink-0"
          title="Trace into this definition"
        >
          ↦ trace
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-text-muted hover:text-text-primary shrink-0"
          title="Close peek"
        >
          ✕
        </button>
      </div>
      {state.status === "loading" && <div className="p-3 text-xs text-text-muted">Loading…</div>}
      {state.status === "error" && (
        <div className="p-3 text-xs text-text-secondary">Source unavailable: {state.error}</div>
      )}
      {state.status === "loaded" && state.source && (
        <div className="max-h-72 overflow-auto bg-root">
          <CodeBlock
            code={state.source.content}
            language={language}
            accessToken={accessToken}
            filePath={node.filePath}
            highlightedRange={range}
            windowStart={range ? Math.max(1, range.start) : undefined}
            windowEnd={range ? range.end : undefined}
            graph={graph}
            currentNodeId={node.id}
            onJumpToNode={(id) => onTrace(id)}
            fontSizeClass="text-[12px] leading-5"
          />
        </div>
      )}
    </div>
  );
}

/** Feature 23: per-hop scope inspector (static). Params / locals / captured / return. */
function ScopeInspector({ sourceSlice }: { sourceSlice: string }) {
  const scope = useMemo(() => parseScope(sourceSlice), [sourceSlice]);
  const Chip = ({ label, color }: { label: string; color: string }) => (
    <span
      className="text-[11px] font-mono px-1.5 py-0.5 rounded border"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      {label}
    </span>
  );
  return (
    <div className="px-3 py-2.5 border-t border-border-subtle bg-surface/40" data-testid="scope-inspector">
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
        Scope inspector <span className="opacity-60">(static)</span>
      </div>
      {scope.signature && (
        <div className="text-[11px] font-mono text-text-secondary mb-2 truncate" title={scope.signature}>
          {scope.signature}
        </div>
      )}
      <div className="space-y-1.5">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted w-16 shrink-0 mt-0.5">params</span>
          {scope.params.length > 0 ? (
            scope.params.map((p) => <Chip key={p} label={p} color="var(--color-node-endpoint)" />)
          ) : (
            <span className="text-[11px] text-text-muted">—</span>
          )}
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted w-16 shrink-0 mt-0.5">locals</span>
          {scope.locals.length > 0 ? (
            scope.locals.map((l) => <Chip key={l} label={l} color="var(--color-node-function)" />)
          ) : (
            <span className="text-[11px] text-text-muted">—</span>
          )}
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-text-muted w-16 shrink-0 mt-0.5">returns</span>
          {scope.returns ? (
            <Chip label={scope.returns} color="var(--color-node-schema)" />
          ) : (
            <span className="text-[11px] text-text-muted">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Feature 29: control-flow mini-diagram — nested structural outline (heuristic). */
function ControlFlowOutlinePanel({
  sourceSlice,
  sliceStart,
}: {
  sourceSlice: string;
  sliceStart: number;
}) {
  const nodes = useMemo(() => controlFlowOutline(sourceSlice, sliceStart), [sourceSlice, sliceStart]);
  const kindColor: Record<string, string> = {
    if: "var(--color-node-endpoint)",
    "else if": "var(--color-node-endpoint)",
    else: "var(--color-node-endpoint)",
    for: "var(--color-node-pipeline)",
    switch: "var(--color-node-class)",
    select: "var(--color-node-class)",
    case: "var(--color-node-class)",
    defer: "var(--color-gold, #d4a843)",
    go: "var(--color-gold, #d4a843)",
    return: "var(--color-node-schema)",
  };
  return (
    <div
      className="px-3 py-2.5 border-t border-border-subtle bg-surface/40"
      data-testid="control-flow-outline"
    >
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
        Control-flow outline <span className="opacity-60">(structural outline · brace-depth heuristic)</span>
      </div>
      {nodes.length === 0 ? (
        <div className="text-[11px] text-text-muted">No control structures detected.</div>
      ) : (
        <div className="space-y-0.5 font-mono">
          {nodes.map((n, i) => {
            const color = kindColor[n.kind] ?? "var(--color-text-muted)";
            return (
              <div
                key={`${n.line}-${i}`}
                className="text-[11px] flex items-center gap-1.5 leading-5"
                style={{ paddingLeft: `${n.depth * 14}px` }}
              >
                <span className="text-text-muted/50">{n.depth > 0 ? "└" : ""}</span>
                <span
                  className="uppercase text-[9px] font-semibold px-1 py-0.5 rounded shrink-0"
                  style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
                >
                  {n.kind}
                </span>
                <span className="text-text-secondary truncate" title={`${n.text} :${n.line}`}>
                  {n.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Thin one-line row for a folded or muted hop. */
function FoldedHopRow({
  node,
  index,
  reason,
  onUnfold,
}: {
  node: GraphNode;
  index: number;
  reason: "folded" | "muted";
  onUnfold: () => void;
}) {
  const color = nodeColorVar(node.type);
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-0 bottom-0 w-px bg-border-subtle" />
      <div
        className="absolute left-[3px] top-3 w-2.5 h-2.5 rounded-full border-2 opacity-50"
        style={{ borderColor: color, backgroundColor: "var(--color-surface, #1a1a1a)" }}
      />
      <div className="flex items-center gap-2 rounded border border-border-subtle/60 bg-elevated/30 px-3 py-1.5 opacity-70">
        <span className="text-[10px] font-mono text-text-muted shrink-0">{index + 1}</span>
        <span className="text-[11px] font-mono text-text-muted truncate flex-1" title={node.name}>
          {node.name}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-text-muted shrink-0">
          {reason === "muted" ? `muted · ${packageLabel(packageOf(node))}` : "folded"}
        </span>
        <button
          type="button"
          onClick={onUnfold}
          className="text-[10px] font-semibold text-accent hover:text-accent-bright shrink-0"
          title="Un-fold this hop"
        >
          show
        </button>
      </div>
    </div>
  );
}

function HopCard({
  node,
  index,
  defaultExpanded,
  accessToken,
  graph,
  pushTrace,
  isCritical,
  dimmed,
  muted,
  onStepInto,
  onStepOver,
  onStepOut,
  registerRef,
  watches,
  onReportMeta,
  heatOn,
  errorPathOn,
  predicateMatch,
  diffStatus,
  scrollToLine,
}: {
  node: GraphNode;
  index: number;
  defaultExpanded: boolean;
  accessToken: string;
  graph: KnowledgeGraph;
  pushTrace: (id: string) => void;
  isCritical: boolean;
  dimmed: boolean;
  muted: boolean;
  onStepInto: (id: string) => void;
  onStepOver: () => void;
  onStepOut: () => void;
  registerRef?: (el: HTMLDivElement | null) => void;
  watches: string[];
  onReportMeta: (id: string, meta: { isError: boolean; watchHits: number }) => void;
  heatOn: boolean;
  errorPathOn: boolean;
  predicateMatch: boolean | null;
  diffStatus: DiffStatus | null;
  scrollToLine: number | null;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showCallers, setShowCallers] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const [showImpls, setShowImpls] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [bundleOpen, setBundleOpen] = useState<Record<string, boolean>>({});
  const color = nodeColorVar(node.type);
  const setTraceRoot = useDashboardStore((s) => s.setTraceRoot);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);
  const bundles = useMemo(() => bundleCalleesByPackage(graph, node.id), [graph, node.id]);
  const callers = useMemo(() => callersOf(graph, node.id), [graph, node.id]);
  const refs = useMemo(() => referencesOf(graph, node.id), [graph, node.id]);
  const impls = useMemo(() => implementationsOf(graph, node.id), [graph, node.id]);
  const interfaces = useMemo(() => interfacesOf(graph, node.id), [graph, node.id]);
  const crumb = useMemo(() => containmentBreadcrumb(node), [node]);

  // Source for this hop (feature 19 concurrency detection + feature 16 peek).
  const hopSource = useHopSource(node.filePath, accessToken);
  const range = node.lineRange ? { start: node.lineRange[0], end: node.lineRange[1] } : null;
  const sourceSlice = useMemo(
    () => sliceSource(hopSource.source?.content, range),
    [hopSource.source, range?.start, range?.end],
  );
  const concurrency = useMemo(() => detectConcurrency(sourceSlice), [sourceSlice]);
  const goCallees = useMemo(
    () => (concurrency.detected ? goroutineCallees(graph, node.id, sourceSlice) : []),
    [concurrency.detected, graph, node.id, sourceSlice],
  );
  const peekNode = useMemo(
    () => (peekId ? graph.nodes.find((n) => n.id === peekId) ?? null : null),
    [peekId, graph.nodes],
  );
  const { state: goNote, explain: explainGo, askFollowUp: askGo, reset: resetGo } =
    useExplain(accessToken, node.id);
  const toggleBookmark = useDashboardStore((s) => s.toggleBookmark);
  const allBookmarks = useDashboardStore((s) => s.workspace.bookmarks);
  const allAnnotations = useDashboardStore((s) => s.workspace.annotations);
  const bookmarked = useMemo(
    () => allBookmarks.some((b) => b.nodeId === node.id),
    [allBookmarks, node.id],
  );
  const annotations = useMemo(
    () => allAnnotations.filter((a) => a.nodeId === node.id),
    [allAnnotations, node.id],
  );
  const addAnnotation = useDashboardStore((s) => s.addAnnotation);
  const removeAnnotation = useDashboardStore((s) => s.removeAnnotation);
  const addWatch = useDashboardStore((s) => s.addWatch);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [showScope, setShowScope] = useState(false);
  const [showCfg, setShowCfg] = useState(false);

  // ---- Wave-3 per-hop debug metadata (heuristic, from the source slice) ----
  const sliceStart = node.lineRange ? Math.max(1, node.lineRange[0]) : 1;
  const errorInfo = useMemo(() => detectErrorHandling(sourceSlice), [sourceSlice]);
  // Fallback to a name/summary heuristic when source hasn't loaded.
  const isError = errorInfo.isError || (!sourceSlice && looksLikeErrorNode(node));
  const watchHits = useMemo(() => {
    let total = 0;
    for (const w of watches) total += watchHitsInSource(w, sourceSlice);
    return total;
  }, [watches, sourceSlice]);
  // The first watched symbol that actually appears in this hop (for "where set").
  const activeWatch = useMemo(
    () => watches.find((w) => watchHitsInSource(w, sourceSlice) > 0) ?? null,
    [watches, sourceSlice],
  );
  const whereSet = useMemo(
    () => (activeWatch ? findAssignmentInSlice(activeWatch, sourceSlice, sliceStart) : null),
    [activeWatch, sourceSlice, sliceStart],
  );
  const fanIn = useMemo(() => callCountOf(graph, node.id), [graph, node.id]);
  const heat = useMemo(() => heatValue(node, fanIn), [node, fanIn]);
  // Imperatively scroll the source into view + highlight a line when requested.
  const [highlightLine, setHighlightLine] = useState<number | null>(null);

  // Report this hop's error / watch status up so the parent can style the
  // error path and minimap (and so predicate `returns error` can match).
  useEffect(() => {
    onReportMeta(node.id, { isError, watchHits });
  }, [node.id, isError, watchHits, onReportMeta]);

  // External request (from "where set" / watch jump) to reveal a line. A
  // non-positive line means "just expand + scroll" (no specific line to flash).
  useEffect(() => {
    if (scrollToLine != null) {
      setExpanded(true);
      if (scrollToLine > 0) {
        setHighlightLine(scrollToLine);
        const t = window.setTimeout(() => setHighlightLine(null), 2600);
        return () => window.clearTimeout(t);
      }
    }
  }, [scrollToLine]);

  const jumpToWhereSet = () => {
    if (!whereSet) return;
    setExpanded(true);
    setHighlightLine(whereSet.line);
    window.setTimeout(() => setHighlightLine(null), 2600);
  };

  const teachGo = () => {
    if (!node.filePath || !node.lineRange) return;
    explainGo(node.filePath, node.lineRange[0], node.lineRange[1], node.lineRange[0]);
  };

  const totalCallees = bundles.reduce((acc, b) => acc + b.nodes.length, 0);

  // Wave-3 compositing of the card's outline + emphasis. Different toggles
  // compose: error-path dims non-error hops; predicate filter/ring; diff colors;
  // heat tints the left dot; critical-path ring stays (different concern).
  const errorDim = errorPathOn && !isError;
  const predicateDim = predicateMatch === false; // explicit non-match
  const dimAll = dimmed || errorDim || predicateDim;
  const diffRing =
    diffStatus === "added"
      ? "ring-1 ring-[rgb(74,222,128)] border-[rgb(74,222,128)]"
      : diffStatus === "moved"
        ? "ring-1 ring-[rgb(251,191,36)] border-[rgb(251,191,36)]"
        : "";
  const predicateRing = predicateMatch === true ? "ring-2 ring-accent border-accent" : "";
  const errorRing = errorPathOn && isError ? "ring-1 ring-[rgb(248,113,113)] border-[rgb(248,113,113)]" : "";
  const dotColor = heatOn ? heatColor(heat) : color;

  return (
    <div className={`relative pl-6 transition-opacity ${dimAll ? "opacity-40" : ""}`} ref={registerRef}>
      {/* Connector rail */}
      <div className="absolute left-2 top-0 bottom-0 w-px bg-border-subtle" />
      <div
        className="absolute left-[3px] top-4 w-2.5 h-2.5 rounded-full border-2"
        style={{ borderColor: dotColor, backgroundColor: heatOn ? dotColor : "var(--color-surface, #1a1a1a)" }}
        title={heatOn ? `complexity heat: ${node.complexity ?? "?"} (${Math.round(heat * 100)})` : undefined}
      />

      <div
        data-testid="hop-card"
        data-error={isError ? "1" : "0"}
        data-watch-hits={watchHits}
        className={`rounded-lg border bg-elevated/60 overflow-hidden ${
          predicateRing || diffRing || errorRing ||
          (isCritical ? "border-accent ring-1 ring-accent/50" : "border-border-subtle")
        }`}
        style={heatOn ? { boxShadow: `inset 4px 0 0 ${heatColor(heat)}` } : undefined}
      >
        {/* Header */}
        <div className="px-3 py-2.5 flex items-start gap-2">
          <span className="text-[10px] font-mono text-text-muted mt-0.5 shrink-0">
            {index + 1}
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0"
            style={{
              color,
              borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
            }}
          >
            {node.type}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-heading text-text-primary truncate flex items-center gap-1.5" title={node.name}>
              {node.name}
              {isCritical && (
                <span className="text-[9px] text-accent" title="On the critical path">◆</span>
              )}
              {concurrency.detected && (
                <span
                  data-testid="concurrency-badge"
                  className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-gold/50 text-gold bg-gold/10 shrink-0"
                  title={`Go concurrency detected (heuristic): ${concurrency.markers.join(", ")}`}
                >
                  ⇄ concurrency
                </span>
              )}
              {watchHits > 0 && (
                <span
                  data-testid="watch-badge"
                  className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/50 text-accent bg-accent/10 shrink-0"
                  title={`Reads/writes/calls a watched symbol ${watchHits}× (heuristic)`}
                >
                  👁 {watchHits}
                </span>
              )}
              {errorPathOn && isError && (
                <span
                  data-testid="error-badge"
                  className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-[rgb(248,113,113)]/60 text-[rgb(248,113,113)] bg-[rgb(248,113,113)]/10 shrink-0"
                  title={`Error handling detected (heuristic): ${errorInfo.markers.join(", ") || "name/summary match"}`}
                >
                  ✦ error
                </span>
              )}
              {diffStatus === "added" && (
                <span className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-[rgb(74,222,128)]/60 text-[rgb(74,222,128)] bg-[rgb(74,222,128)]/10 shrink-0" title="Added vs snapshot">
                  + added
                </span>
              )}
              {diffStatus === "moved" && (
                <span className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-[rgb(251,191,36)]/60 text-[rgb(251,191,36)] bg-[rgb(251,191,36)]/10 shrink-0" title="Moved vs snapshot">
                  ↕ moved
                </span>
              )}
            </div>
            {/* Feature 17: containment breadcrumb pkg › file › func */}
            <div
              data-testid="hop-breadcrumb"
              className="text-[10px] font-mono text-text-muted truncate flex items-center gap-1"
              title={lineLabel(node)}
            >
              <span className="text-node-file/80">{crumb.pkg}</span>
              <span className="opacity-50">›</span>
              <span className="text-node-class/80">{crumb.file}</span>
              <span className="opacity-50">›</span>
              <span className="text-text-secondary">{crumb.name}</span>
              {node.lineRange && <span className="opacity-50">:{node.lineRange[0]}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleBookmark(node.id, node.name)}
            className={`shrink-0 mt-0.5 transition-colors ${
              bookmarked ? "text-accent" : "text-text-muted hover:text-accent"
            }`}
            title={bookmarked ? "Remove bookmark" : "Bookmark this node"}
            aria-label="Bookmark"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.5l2.34 4.74 5.23.76-3.78 3.69.89 5.2-4.68-2.46-4.68 2.46.89-5.2L4.95 9l5.23-.76 1.3-2.64z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className={`shrink-0 mt-0.5 transition-colors ${
              annotations.length > 0 ? "text-node-schema" : "text-text-muted hover:text-text-primary"
            }`}
            title="Add a note / annotation"
            aria-label="Annotate"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5M17.5 3.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 8.5-8.5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-text-muted hover:text-text-primary transition-colors shrink-0 mt-0.5"
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Navigation affordances row: focus + step into/over/out + callers expander */}
        <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setTraceRoot(node.id)}
            className="text-[10px] font-semibold px-2 py-1 rounded border border-gold/40 text-gold hover:text-gold-bright hover:border-gold/70 transition-colors"
            title="Re-root the trace at this node (focus subtree)"
          >
            ⊙ focus
          </button>
          <div className="flex rounded border border-border-subtle overflow-hidden">
            <button
              type="button"
              onClick={() => onStepInto(node.id)}
              className="text-[10px] font-semibold px-2 py-1 text-text-muted hover:text-text-primary transition-colors"
              title="Step into — descend into this hop"
            >
              ↳ into
            </button>
            <button
              type="button"
              onClick={onStepOver}
              className="text-[10px] font-semibold px-2 py-1 text-text-muted hover:text-text-primary transition-colors border-l border-border-subtle"
              title="Step over — collapse and skip to next sibling"
            >
              ↷ over
            </button>
            <button
              type="button"
              onClick={onStepOut}
              className="text-[10px] font-semibold px-2 py-1 text-text-muted hover:text-text-primary transition-colors border-l border-border-subtle"
              title="Step out — return to the parent hop"
            >
              ↰ out
            </button>
          </div>
          {callers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCallers((v) => !v)}
              className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                showCallers
                  ? "border-node-schema/60 text-node-schema bg-node-schema/10"
                  : "border-border-subtle text-text-muted hover:text-text-primary"
              }`}
              title="Show who calls this node"
            >
              ▲ {callers.length} caller{callers.length === 1 ? "" : "s"}
            </button>
          )}
          {/* Feature 13: find references / callers panel */}
          {refs.length > 0 && (
            <button
              type="button"
              data-testid="references-button"
              onClick={() => setShowRefs((v) => !v)}
              className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                showRefs
                  ? "border-accent/60 text-accent bg-accent/10"
                  : "border-border-subtle text-text-muted hover:text-text-primary"
              }`}
              title="Find references — every caller / importer grouped by file"
            >
              ↪ {refs.length} reference{refs.length === 1 ? "" : "s"}
            </button>
          )}
          {/* Feature 14: go-to-implementation (interface → impls) */}
          {impls.length > 0 && (
            <button
              type="button"
              data-testid="implementations-button"
              onClick={() => setShowImpls((v) => !v)}
              className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                showImpls
                  ? "border-node-class/60 text-node-class bg-node-class/10"
                  : "border-border-subtle text-text-muted hover:text-text-primary"
              }`}
              title="Show concrete implementations of this interface"
            >
              ◇ implementations ({impls.length})
            </button>
          )}
          {/* Feature 14: impl → interface */}
          {interfaces.length > 0 && (
            <button
              type="button"
              data-testid="interface-button"
              onClick={() => startTraceAt(interfaces[0].id)}
              className="text-[10px] font-semibold px-2 py-1 rounded border border-border-subtle text-text-muted hover:text-node-class hover:border-node-class/60 transition-colors"
              title={`Go to interface: ${interfaces[0].name}`}
            >
              ◆ go to interface
            </button>
          )}
          {/* Feature 21: watch this symbol */}
          <button
            type="button"
            data-testid="watch-button"
            onClick={() => addWatch(node.name)}
            className="text-[10px] font-semibold px-2 py-1 rounded border border-border-subtle text-text-muted hover:text-accent hover:border-accent/60 transition-colors"
            title={`Watch "${node.name}" — badge every hop whose source reads/writes/calls it`}
          >
            👁 watch
          </button>
          {/* Feature 22: jump to where a watched symbol was set (heuristic dataflow) */}
          {whereSet && activeWatch && (
            <button
              type="button"
              data-testid="where-set-button"
              onClick={jumpToWhereSet}
              className="text-[10px] font-semibold px-2 py-1 rounded border border-accent/40 text-accent hover:text-accent-bright hover:border-accent/70 transition-colors"
              title={`Heuristic dataflow: ${activeWatch} ${whereSet.kind} at line ${whereSet.line} — "${whereSet.text}"`}
            >
              ↩ where set ({activeWatch})
            </button>
          )}
          {/* Feature 23: scope inspector */}
          <button
            type="button"
            data-testid="scope-button"
            onClick={() => setShowScope((v) => !v)}
            className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
              showScope ? "border-node-endpoint/60 text-node-endpoint bg-node-endpoint/10" : "border-border-subtle text-text-muted hover:text-text-primary"
            }`}
            title="Scope inspector — params, locals, return (static)"
          >
            ⊞ scope
          </button>
          {/* Feature 29: control-flow outline */}
          <button
            type="button"
            data-testid="cfg-button"
            onClick={() => setShowCfg((v) => !v)}
            className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
              showCfg ? "border-node-pipeline/60 text-node-pipeline bg-node-pipeline/10" : "border-border-subtle text-text-muted hover:text-text-primary"
            }`}
            title="Control-flow mini-diagram — nested structural outline (heuristic)"
          >
            ⑂ control-flow
          </button>
        </div>

        {/* Feature 14: implementations expander */}
        {showImpls && impls.length > 0 && (
          <div className="px-3 pb-2.5 -mt-1" data-testid="implementations-list">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              Implementations — click to trace through that impl
            </div>
            <div className="flex flex-wrap gap-1.5">
              {impls.map((im) => (
                <button
                  key={im.id}
                  type="button"
                  onClick={() => startTraceAt(im.id)}
                  className="text-[11px] px-2 py-1 rounded border border-node-class/30 text-node-class hover:border-node-class/60 hover:bg-node-class/10 transition-colors font-mono"
                  title={lineLabel(im)}
                >
                  ◇ {packageLabel(packageOf(im))} → {im.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feature 13: references panel grouped by file */}
        {showRefs && (
          <ReferencesPanel
            node={node}
            graph={graph}
            onClose={() => setShowRefs(false)}
            onJump={(id) => setTraceRoot(id)}
          />
        )}

        {/* Feature 19: goroutine stitching — dashed causal links to goroutine bodies */}
        {goCallees.length > 0 && (
          <div className="px-3 pb-2.5 -mt-1" data-testid="goroutine-links">
            <div className="text-[10px] uppercase tracking-wider text-gold/80 mb-1.5">
              ⇄ goroutine bodies (heuristic) — follow the concurrent callee
            </div>
            <div className="flex flex-wrap gap-1.5">
              {goCallees.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => pushTrace(g.id)}
                  className="text-[11px] px-2 py-1 rounded border border-dashed border-gold/50 text-gold hover:bg-gold/10 transition-colors font-mono"
                  title={`go → ${g.name} (${lineLabel(g)})`}
                >
                  ⇢ go {g.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Callers list (walk-up) */}
        {showCallers && callers.length > 0 && (
          <div className="px-3 pb-2.5 -mt-1">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              Called by — click to focus that caller
            </div>
            <div className="flex flex-wrap gap-1.5">
              {callers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTraceRoot(c.id)}
                  className="text-[11px] px-2 py-1 rounded border border-node-schema/30 text-node-schema hover:border-node-schema/60 hover:bg-node-schema/10 transition-colors font-mono"
                  title={lineLabel(c)}
                >
                  ▲ {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Explanation */}
        <div className="px-3 pb-2.5 -mt-1">
          <p className="text-[12px] text-text-secondary leading-relaxed">
            {node.summary?.trim() ? node.summary : "—"}
          </p>
          {annotations.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {annotations.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 rounded-md border border-node-schema/30 bg-node-schema/5 px-2.5 py-1.5"
                >
                  <span className="text-node-schema text-[11px] mt-0.5">📌</span>
                  <p className="flex-1 text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                    {a.text}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeAnnotation(a.id)}
                    className="text-text-muted hover:text-node-concept text-xs shrink-0"
                    title="Remove note"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {noteOpen && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && noteDraft.trim()) {
                    addAnnotation(node.id, noteDraft.trim(), node.lineRange ?? null);
                    setNoteDraft("");
                    setNoteOpen(false);
                  }
                }}
                placeholder="Add a note about this hop…"
                className="flex-1 min-w-0 bg-surface text-text-primary text-[12px] rounded-md px-2.5 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
              />
              <button
                type="button"
                onClick={() => {
                  if (!noteDraft.trim()) return;
                  addAnnotation(node.id, noteDraft.trim(), node.lineRange ?? null);
                  setNoteDraft("");
                  setNoteOpen(false);
                }}
                className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-accent/40 text-accent hover:text-accent-bright transition-colors"
              >
                Pin
              </button>
            </div>
          )}

          {/* Go note — excluded for muted hops */}
          {!muted && node.filePath && node.lineRange && (
            <div className="mt-1.5">
              {goNote.status === "idle" ? (
                <button
                  type="button"
                  onClick={teachGo}
                  className="text-[10px] font-semibold text-accent hover:text-accent-bright transition-colors"
                  title="Get a beginner Go explanation for this hop"
                >
                  ✦ Teach me the Go here
                </button>
              ) : (
                <ExplainPanel state={goNote} title="✦ Go note" onClose={resetGo} onAsk={askGo} />
              )}
            </div>
          )}
        </div>

        {/* Feature 23: scope inspector (static) */}
        {showScope && sourceSlice && <ScopeInspector sourceSlice={sourceSlice} />}

        {/* Feature 29: control-flow outline (structural) */}
        {showCfg && sourceSlice && (
          <ControlFlowOutlinePanel sourceSlice={sourceSlice} sliceStart={sliceStart} />
        )}

        {expanded && (
          <div className="border-t border-border-subtle">
            <HopCode
              node={node}
              accessToken={accessToken}
              graph={graph}
              pushTrace={pushTrace}
              state={hopSource}
              inlayHints
              onPeekNode={(id) => setPeekId((cur) => (cur === id ? null : id))}
              flashLine={highlightLine}
            />
          </div>
        )}

        {/* Feature 16: inline peek of a callee definition (collapsible) */}
        {peekNode && (
          <div className="px-3 py-2.5 border-t border-border-subtle bg-surface/30">
            <PeekDefinition
              node={peekNode}
              accessToken={accessToken}
              graph={graph}
              onClose={() => setPeekId(null)}
              onTrace={(id) => {
                setPeekId(null);
                pushTrace(id);
              }}
            />
          </div>
        )}

        {/* Outgoing calls — bundled by package when many into the same package */}
        {totalCallees > 0 && (
          <div className="px-3 py-2.5 border-t border-border-subtle bg-surface/40">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              Calls ({totalCallees}) — click to descend · ⊙ peek inline
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bundles.map((b) => {
                // Bundle 3+ calls into the same package into one expandable row.
                if (b.nodes.length >= 3) {
                  const open = bundleOpen[b.pkg];
                  return (
                    <span key={b.pkg} className="inline-flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setBundleOpen((s) => ({ ...s, [b.pkg]: !s[b.pkg] }))
                        }
                        className="text-[11px] px-2 py-1 rounded border border-gold/40 text-gold hover:text-gold-bright hover:border-gold/70 transition-colors font-mono"
                        title={`${b.nodes.length} calls into ${b.pkg}`}
                      >
                        → {packageLabel(b.pkg)} ({b.nodes.length}) {open ? "▾" : "▸"}
                      </button>
                      {open && (
                        <span className="flex flex-wrap gap-1.5 pl-2">
                          {b.nodes.map((t) => (
                            <CalleeChip
                              key={t.id}
                              node={t}
                              active={peekId === t.id}
                              onDescend={() => pushTrace(t.id)}
                              onPeek={() => setPeekId((cur) => (cur === t.id ? null : t.id))}
                            />
                          ))}
                        </span>
                      )}
                    </span>
                  );
                }
                return b.nodes.map((t) => (
                  <CalleeChip
                    key={t.id}
                    node={t}
                    active={peekId === t.id}
                    onDescend={() => pushTrace(t.id)}
                    onPeek={() => setPeekId((cur) => (cur === t.id ? null : t.id))}
                  />
                ));
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A callee chip: click name → descend (trace); click ⊙ → peek inline (feature
 * 16). Hovering the chip shows the hover popover (feature 15).
 */
function CalleeChip({
  node,
  active,
  onDescend,
  onPeek,
}: {
  node: GraphNode;
  active: boolean;
  onDescend: () => void;
  onPeek: () => void;
}) {
  const graph = useDashboardStore((s) => s.graph);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const timer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const onEnter = (e: React.MouseEvent) => {
    if (!graph) return;
    const x = e.clientX;
    const y = e.clientY;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    timer.current = window.setTimeout(() => setHover({ node, x, y }), 350);
  };
  const onLeave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    closeTimer.current = window.setTimeout(() => setHover(null), 220);
  };

  return (
    <span className="inline-flex items-stretch rounded border border-accent/30 overflow-hidden" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        type="button"
        onClick={onPeek}
        className={`text-[11px] px-1.5 py-1 border-r border-accent/30 font-mono transition-colors ${
          active ? "bg-accent/20 text-accent-bright" : "text-accent/70 hover:text-accent hover:bg-accent/10"
        }`}
        title="Peek this definition inline"
      >
        ⊙
      </button>
      <button
        type="button"
        onClick={onDescend}
        className="text-[11px] px-2 py-1 text-accent hover:text-accent-bright hover:bg-accent/10 transition-colors font-mono"
        title={lineLabel(node)}
      >
        {node.name} →
      </button>
      {hover && (
        <span onMouseEnter={() => closeTimer.current && window.clearTimeout(closeTimer.current)}>
          <HoverPopover target={hover} onClose={() => setHover(null)} />
        </span>
      )}
    </span>
  );
}

/** Minimap rail: indented outline of all hops; active subtree highlighted. */
function Minimap({
  hops,
  focusId,
  criticalIds,
  onPick,
}: {
  hops: GraphNode[];
  focusId: string;
  criticalIds: Set<string>;
  onPick: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface/50 p-2 sticky top-2">
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5 px-1">
        Minimap ({hops.length})
      </div>
      <div className="space-y-0.5 max-h-[70vh] overflow-auto">
        {hops.map((h, i) => {
          const active = h.id === focusId;
          const crit = criticalIds.has(h.id);
          return (
            <button
              key={`${h.id}-${i}`}
              type="button"
              onClick={() => onPick(h.id)}
              className={`block w-full text-left text-[10px] font-mono truncate px-1.5 py-0.5 rounded transition-colors ${
                active
                  ? "bg-accent/15 text-accent"
                  : crit
                    ? "text-accent/80 hover:bg-elevated"
                    : "text-text-muted hover:bg-elevated hover:text-text-primary"
              }`}
              style={{ paddingLeft: `${6 + Math.min(i, 8) * 6}px` }}
              title={h.name}
            >
              {crit ? "◆ " : ""}
              {h.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Shape" layout: horizontal bars sized by subtree node-count. */
function ShapeView({
  hops,
  graph,
  direction,
  onPick,
}: {
  hops: GraphNode[];
  graph: KnowledgeGraph;
  direction: "callees" | "callers";
  onPick: (id: string) => void;
}) {
  const sizes = useMemo(
    () => hops.map((h) => subtreeSize(graph, h.id, direction)),
    [hops, graph, direction],
  );
  const max = Math.max(1, ...sizes);
  return (
    <div className="space-y-1.5">
      {hops.map((h, i) => {
        const pct = Math.max(6, Math.round((sizes[i] / max) * 100));
        const color = nodeColorVar(h.type);
        return (
          <button
            key={`${h.id}-${i}`}
            type="button"
            onClick={() => onPick(h.id)}
            className="block w-full text-left group"
            title={`${h.name} — subtree ${sizes[i]}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-text-muted w-6 shrink-0">{i + 1}</span>
              <div className="flex-1 h-5 rounded bg-elevated/40 overflow-hidden relative">
                <div
                  className="h-full rounded transition-all group-hover:brightness-125"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: `color-mix(in srgb, ${color} 45%, transparent)`,
                  }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-[11px] font-mono text-text-primary truncate">
                  {h.name}
                </span>
              </div>
              <span className="text-[10px] font-mono text-text-muted w-8 text-right shrink-0">
                {sizes[i]}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Feature 21: Watches panel — list watched symbols, remove, jump-to-next. */
function WatchesPanel({
  watches,
  hitCounts,
  onRemove,
  onJumpNext,
}: {
  watches: string[];
  hitCounts: Record<string, number>;
  onRemove: (sym: string) => void;
  onJumpNext: (sym: string) => void;
}) {
  if (watches.length === 0) return null;
  return (
    <div
      data-testid="watches-panel"
      className="rounded-lg border border-accent/30 bg-surface/60 p-2.5"
    >
      <div className="text-[10px] uppercase tracking-wider text-accent mb-1.5">
        👁 Watches ({watches.length}) — persists in workspace
      </div>
      <div className="flex flex-wrap gap-1.5">
        {watches.map((w) => (
          <span
            key={w}
            className="inline-flex items-stretch rounded border border-accent/30 overflow-hidden"
          >
            <button
              type="button"
              data-testid="watch-jump"
              onClick={() => onJumpNext(w)}
              className="text-[11px] font-mono px-2 py-1 text-accent hover:bg-accent/10 transition-colors"
              title={`Jump to next hop that touches ${w}`}
            >
              {w}
              <span className="ml-1.5 text-[9px] text-text-muted">
                {hitCounts[w] ?? 0} hop{(hitCounts[w] ?? 0) === 1 ? "" : "s"} ↦
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(w)}
              className="text-[10px] px-1.5 py-1 text-text-muted hover:text-node-concept border-l border-accent/30 transition-colors"
              title={`Stop watching ${w}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Feature 26/27/28/30: the Wave-3 debug toolbar (predicate + toggles + diff). */
function DebugBar({
  errorPathHopCount,
  onExplainErrorPath,
  explainState,
  explainPanel,
}: {
  errorPathHopCount: number;
  onExplainErrorPath: () => void;
  explainState: "idle" | "loading" | "loaded" | "error";
  explainPanel: React.ReactNode;
}) {
  const predicate = useDashboardStore((s) => s.tracePredicate);
  const setPredicate = useDashboardStore((s) => s.setPredicate);
  const predicateFilter = useDashboardStore((s) => s.tracePredicateFilter);
  const togglePredicateFilter = useDashboardStore((s) => s.togglePredicateFilter);
  const errorPath = useDashboardStore((s) => s.traceErrorPath);
  const toggleErrorPath = useDashboardStore((s) => s.toggleErrorPath);
  const heat = useDashboardStore((s) => s.traceHeat);
  const toggleHeat = useDashboardStore((s) => s.toggleHeat);
  const snapshots = useDashboardStore((s) => s.traceSnapshots);
  const diffBaseline = useDashboardStore((s) => s.traceDiffBaseline);
  const setDiffBaseline = useDashboardStore((s) => s.setDiffBaseline);
  const removeSnapshot = useDashboardStore((s) => s.removeSnapshot);

  const [draft, setDraft] = useState(predicate);

  const btn =
    "text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded border transition-colors";
  const idle = "border-border-subtle text-text-muted hover:text-text-primary hover:border-border-medium";
  const active = "border-accent/60 text-accent bg-accent/10";

  return (
    <div className="flex flex-col gap-2" data-testid="debug-bar">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Feature 26: predicate bar */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border-subtle">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">Highlight</span>
          <input
            type="text"
            data-testid="predicate-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setPredicate(draft.trim());
            }}
            onBlur={() => setPredicate(draft.trim())}
            placeholder="returns error · package:X · calls:Y · name:~re · complexity:complex"
            className="bg-surface text-text-primary text-[11px] rounded px-2 py-1 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted w-[300px]"
          />
          {predicate && (
            <button
              type="button"
              onClick={() => {
                setPredicate("");
                setDraft("");
              }}
              className="text-[10px] text-text-muted hover:text-node-concept"
              title="Clear predicate"
            >
              ✕
            </button>
          )}
        </div>
        {predicate && (
          <button
            type="button"
            data-testid="predicate-filter"
            onClick={togglePredicateFilter}
            className={`${btn} ${predicateFilter ? active : idle}`}
            title="Filter to only matching hops"
          >
            ⧂ filter to matches
          </button>
        )}

        {/* Feature 27: error path */}
        <button
          type="button"
          data-testid="error-path-toggle"
          onClick={toggleErrorPath}
          className={`${btn} ${errorPath ? "border-[rgb(248,113,113)]/60 text-[rgb(248,113,113)] bg-[rgb(248,113,113)]/10" : idle}`}
          title="Highlight the error-handling path (heuristic: if err != nil, return …err, errors.Wrap)"
        >
          ✦ Error path{errorPath && errorPathHopCount > 0 ? ` (${errorPathHopCount})` : ""}
        </button>

        {/* Feature 28: complexity heat */}
        <button
          type="button"
          data-testid="heat-toggle"
          onClick={toggleHeat}
          className={`${btn} ${heat ? active : idle}`}
          title="Color hops by complexity (green→amber→red), fallback LOC/fan-in"
        >
          ◐ Heat
        </button>

        {/* Feature 30: snapshot + diff */}
        {diffBaseline && (
          <button
            type="button"
            data-testid="diff-clear"
            onClick={() => setDiffBaseline(null)}
            className={`${btn} ${active}`}
            title="Stop diffing"
          >
            ✕ clear diff
          </button>
        )}
      </div>

      {/* Heat legend */}
      {heat && (
        <div className="flex items-center gap-2 text-[10px] text-text-muted" data-testid="heat-legend">
          <span className="uppercase tracking-wider">Heat</span>
          <span className="inline-block w-32 h-2 rounded" style={{ background: `linear-gradient(90deg, ${heatColor(0.1)}, ${heatColor(0.5)}, ${heatColor(0.95)})` }} />
          <span>simple</span>
          <span className="opacity-50">→</span>
          <span>complex</span>
          <span className="opacity-60">(by complexity · fallback LOC/fan-in)</span>
        </div>
      )}

      {/* Snapshots list (feature 30) */}
      {snapshots.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="snapshots-list">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">Snapshots</span>
          {snapshots.map((sn) => {
            const armed = diffBaseline === sn.id;
            return (
              <span key={sn.id} className="inline-flex items-stretch rounded border border-border-subtle overflow-hidden">
                <button
                  type="button"
                  data-testid="snapshot-diff"
                  onClick={() => setDiffBaseline(armed ? null : sn.id)}
                  className={`text-[10px] font-mono px-2 py-1 transition-colors ${
                    armed ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
                  }`}
                  title={`${armed ? "Diffing against" : "Diff vs"} "${sn.name}" (${sn.ids.length} hops, ${sn.createdAt.slice(11, 19)})`}
                >
                  {armed ? "◉ " : "○ "}
                  {sn.name} ({sn.ids.length})
                </button>
                <button
                  type="button"
                  onClick={() => removeSnapshot(sn.id)}
                  className="text-[10px] px-1.5 py-1 text-text-muted hover:text-node-concept border-l border-border-subtle"
                  title="Delete snapshot"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Feature 27: explain this error path */}
      {errorPath && errorPathHopCount > 0 && (
        <div>
          {explainState === "idle" ? (
            <button
              type="button"
              data-testid="explain-error-path"
              onClick={onExplainErrorPath}
              className="text-[10px] font-semibold text-[rgb(248,113,113)] hover:brightness-125 transition-all"
              title="Send the failing hop chain to claude -p"
            >
              ✦ explain this error path
            </button>
          ) : (
            explainPanel
          )}
        </div>
      )}
    </div>
  );
}

export default function TraceView({ accessToken }: TraceViewProps) {
  const graph = useDashboardStore((s) => s.graph);
  const traceRoot = useDashboardStore((s) => s.traceRoot);
  const traceStack = useDashboardStore((s) => s.traceStack);
  const pushTrace = useDashboardStore((s) => s.pushTrace);
  const popTrace = useDashboardStore((s) => s.popTrace);
  const truncateTrace = useDashboardStore((s) => s.truncateTrace);
  const setTraceRoot = useDashboardStore((s) => s.setTraceRoot);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const saveTour = useDashboardStore((s) => s.saveTour);
  const toggleBookmarksPanel = useDashboardStore((s) => s.toggleBookmarksPanel);

  // Wave-1 nav state
  const direction = useDashboardStore((s) => s.traceDirection);
  const depth = useDashboardStore((s) => s.traceDepth);
  const layout = useDashboardStore((s) => s.traceLayout);
  const foldedPatterns = useDashboardStore((s) => s.traceFoldedPatterns);
  const unfolded = useDashboardStore((s) => s.traceUnfolded);
  const toggleUnfold = useDashboardStore((s) => s.toggleUnfold);
  const mutedPackages = useDashboardStore((s) => s.traceMutedPackages);
  const muteSeeded = useDashboardStore((s) => s.traceMuteSeeded);
  const seedMutedPackages = useDashboardStore((s) => s.seedMutedPackages);
  const criticalOn = useDashboardStore((s) => s.traceCriticalPath);
  const pathTarget = useDashboardStore((s) => s.tracePathTarget);
  const setPathTarget = useDashboardStore((s) => s.setPathTarget);

  // Wave-3 debug state
  const watches = useDashboardStore((s) => s.workspace.watches);
  const removeWatch = useDashboardStore((s) => s.removeWatch);
  const predicateStr = useDashboardStore((s) => s.tracePredicate);
  const predicateFilter = useDashboardStore((s) => s.tracePredicateFilter);
  const errorPathOn = useDashboardStore((s) => s.traceErrorPath);
  const heatOn = useDashboardStore((s) => s.traceHeat);
  const snapshotTrace = useDashboardStore((s) => s.snapshotTrace);
  const diffBaseline = useDashboardStore((s) => s.traceDiffBaseline);
  const snapshots = useDashboardStore((s) => s.traceSnapshots);

  const [copied, setCopied] = useState(false);
  const [tourSaved, setTourSaved] = useState(false);
  const [snapped, setSnapped] = useState(false);
  const hopRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Feature 21/22: per-hop debug metadata reported up by HopCards.
  const [hopMeta, setHopMeta] = useState<Record<string, { isError: boolean; watchHits: number }>>({});
  const reportMeta = useRef((id: string, meta: { isError: boolean; watchHits: number }) => {
    setHopMeta((prev) => {
      const cur = prev[id];
      if (cur && cur.isError === meta.isError && cur.watchHits === meta.watchHits) return prev;
      return { ...prev, [id]: meta };
    });
  }).current;
  // Feature 21/22: when set, ask HopCard #index to reveal a line (jump).
  const [jumpRequest, setJumpRequest] = useState<{ index: number; line: number | null; nonce: number } | null>(null);

  const focusId = traceStack.length > 0 ? traceStack[traceStack.length - 1] : traceRoot;

  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );

  const rawHops = useMemo(() => {
    if (!graph || !focusId) return [];
    return buildTrace(graph, focusId, depth, direction);
  }, [graph, focusId, depth, direction]);

  // Path-between-two-nodes mode overrides the normal hop list.
  const pathHops = useMemo(() => {
    if (!graph || !focusId || !pathTarget) return null;
    const ids = pathBetween(graph, focusId, pathTarget, true);
    if (!ids) return [];
    return ids.map((id) => nodesById.get(id)).filter((n): n is GraphNode => n !== undefined);
  }, [graph, focusId, pathTarget, nodesById]);

  const hops = pathHops ?? rawHops;

  // Critical path ids (only meaningful in callees/callers tree mode).
  const criticalIds = useMemo(() => {
    if (!graph || !focusId || !criticalOn || pathTarget) return new Set<string>();
    return computeCriticalPath(graph, focusId, direction);
  }, [graph, focusId, criticalOn, direction, pathTarget]);

  // ---- Wave-3 derived debug state --------------------------------------
  const currentIds = useMemo(() => hops.map((h) => h.id), [hops]);

  // Feature 26: parse predicate + per-hop match (uses reported error meta).
  const predicate = useMemo(() => parsePredicate(predicateStr), [predicateStr]);
  const predicateActive = predicate.kind !== "";
  const predicateMatchById = useMemo(() => {
    const m = new Map<string, boolean>();
    if (!graph || !predicateActive) return m;
    for (const h of hops) {
      const isErr = hopMeta[h.id]?.isError ?? looksLikeErrorNode(h);
      m.set(h.id, hopMatchesPredicate(predicate, h, graph, isErr));
    }
    return m;
  }, [graph, predicate, predicateActive, hops, hopMeta]);

  // Feature 27: error-path hop ids (reported error status, fallback heuristic).
  const errorPathIds = useMemo(() => {
    const s = new Set<string>();
    for (const h of hops) {
      const isErr = hopMeta[h.id]?.isError ?? looksLikeErrorNode(h);
      if (isErr) s.add(h.id);
    }
    return s;
  }, [hops, hopMeta]);

  // Feature 30: diff current trace vs the armed snapshot baseline.
  const diff = useMemo(() => {
    const snap = snapshots.find((s) => s.id === diffBaseline);
    if (!snap) return null;
    return diffTraceIds(currentIds, snap.ids);
  }, [snapshots, diffBaseline, currentIds]);

  // Feature 27: explain-the-error-path via claude -p (reuse the existing hook).
  const { state: errExplain, explain: runErrExplain, askFollowUp: askErr, reset: resetErr } =
    useExplain(accessToken);
  const explainErrorPath = () => {
    const errHops = hops.filter((h) => errorPathIds.has(h.id));
    const target = errHops.find((h) => h.filePath && h.lineRange) ?? errHops[0];
    if (target?.filePath && target.lineRange) {
      runErrExplain(target.filePath, target.lineRange[0], target.lineRange[1], target.lineRange[0]);
    }
  };

  // Feature 21: jump to the next hop that touches any watched symbol, cycling
  // through occurrences on repeated clicks. (Aggregate watchHits signal — exact
  // per-watch line targeting happens inside the hop via "↩ where set".)
  const watchCursor = useRef(0);
  const jumpToWatch = (_sym: string) => {
    const hitIdxs = hops
      .map((h, i) => ((hopMeta[h.id]?.watchHits ?? 0) > 0 ? i : -1))
      .filter((i) => i >= 0);
    if (hitIdxs.length === 0) return;
    const target = hitIdxs[watchCursor.current % hitIdxs.length];
    watchCursor.current += 1;
    setJumpRequest({ index: target, line: null, nonce: Date.now() });
    const el = hopRefs.current.get(target);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Per-watch hop counts for the Watches panel.
  const watchHopCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of watches) counts[w] = 0;
    for (const h of hops) {
      if ((hopMeta[h.id]?.watchHits ?? 0) > 0) {
        // Attribute to every watch (cheap; exact per-watch attribution would
        // require per-watch source scanning here — kept aggregate).
        for (const w of watches) counts[w] = (counts[w] ?? 0) + 1;
      }
    }
    return counts;
  }, [watches, hops, hopMeta]);

  // Packages present in the trace + default-mute seeding.
  const packagesPresent = useMemo(() => packagesIn(hops), [hops]);
  useEffect(() => {
    if (!muteSeeded && packagesPresent.length > 0) {
      seedMutedPackages(defaultMutedPackages(packagesPresent));
    }
  }, [muteSeeded, packagesPresent, seedMutedPackages]);

  if (!graph) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-root">
        <p className="text-text-muted text-sm">No graph loaded.</p>
      </div>
    );
  }

  if (!focusId || !nodesById.has(focusId)) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-root p-8">
        <div className="max-w-md text-center">
          <p className="text-text-secondary text-sm mb-2">No node selected to trace.</p>
          <p className="text-text-muted text-xs">
            Pick a function node in Structure view and hit “▶ Trace flow from here”.
          </p>
        </div>
      </div>
    );
  }

  const focusNode = nodesById.get(focusId)!;
  const rootNode = traceRoot ? nodesById.get(traceRoot) : undefined;
  const totalCalls = hops.reduce((acc, h) => acc + callTargets(graph, h.id).length, 0);

  const breadcrumb = traceStack
    .map((id) => nodesById.get(id))
    .filter((n): n is GraphNode => n !== undefined);

  const parentId =
    traceStack.length > 1 ? traceStack[traceStack.length - 2] : null;

  const copyTrace = () => {
    const lines = hops.map((h, i) => {
      const loc = lineLabel(h);
      const summary = h.summary?.trim() ? h.summary.trim() : "(no summary)";
      return `${i + 1}. ${h.name}  [${loc}]\n   ${summary}`;
    });
    const header = `Trace from ${focusNode.name} (${lineLabel(focusNode)}):`;
    const text = `${header}\n\n${lines.join("\n\n")}`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  // Classify each hop for fold/mute rendering. Path mode renders all hops raw.
  type HopClass = "full" | "folded" | "muted";
  const classify = (n: GraphNode): HopClass => {
    if (pathTarget) return "full";
    if (unfolded.has(n.id)) return "full";
    if (mutedPackages.has(packageOf(n))) return "muted";
    if (matchesFoldPattern(n.name, foldedPatterns)) return "folded";
    return "full";
  };

  // Step ops (pure tree ops over the breadcrumb stack).
  const stepInto = (id: string) => pushTrace(id);
  const stepOut = () => popTrace();
  const stepOver = (idx: number) => {
    const next = hopRefs.current.get(idx + 1);
    if (next) next.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Feature 26: when "filter to matches" is on, hide non-matching hops entirely.
  const hiddenByPredicate = (node: GraphNode): boolean =>
    predicateActive && predicateFilter && !(predicateMatchById.get(node.id) ?? false);

  const renderHop = (node: GraphNode, i: number) => {
    if (hiddenByPredicate(node)) return null;
    const cls = classify(node);
    if (cls === "folded") {
      return (
        <FoldedHopRow
          key={`${node.id}-${i}`}
          node={node}
          index={i}
          reason="folded"
          onUnfold={() => toggleUnfold(node.id)}
        />
      );
    }
    if (cls === "muted") {
      return (
        <FoldedHopRow
          key={`${node.id}-${i}`}
          node={node}
          index={i}
          reason="muted"
          onUnfold={() => toggleUnfold(node.id)}
        />
      );
    }
    const isCritical = criticalIds.has(node.id);
    const dimmed = criticalOn && criticalIds.size > 0 && !isCritical;
    const predicateMatch = predicateActive ? (predicateMatchById.get(node.id) ?? false) : null;
    const diffStatus = diff ? (diff.statusById.get(node.id) ?? null) : null;
    const scrollToLine =
      jumpRequest && jumpRequest.index === i ? jumpRequest.line ?? -1 : null;
    return (
      <HopCard
        key={`${node.id}-${i}`}
        node={node}
        index={i}
        defaultExpanded={layout === "nested" && i < 2}
        accessToken={accessToken}
        graph={graph}
        pushTrace={pushTrace}
        isCritical={isCritical}
        dimmed={dimmed}
        muted={false}
        onStepInto={stepInto}
        onStepOver={() => stepOver(i)}
        onStepOut={stepOut}
        registerRef={(el) => {
          if (el) hopRefs.current.set(i, el);
          else hopRefs.current.delete(i);
        }}
        watches={watches}
        onReportMeta={reportMeta}
        heatOn={heatOn}
        errorPathOn={errorPathOn}
        predicateMatch={predicateMatch}
        diffStatus={diffStatus}
        scrollToLine={scrollToLine}
      />
    );
  };

  const noCallChain = rawHops.length <= 1 && !pathTarget;

  return (
    <div className="h-full w-full overflow-auto bg-root">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border-subtle px-5 py-3">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
            Flow / Trace
          </span>
          {traceStack.length > 1 && (
            <button
              type="button"
              onClick={popTrace}
              className="text-[11px] font-semibold text-gold hover:text-gold-bright transition-colors flex items-center gap-1"
            >
              <span>←</span>
              <span>Back</span>
            </button>
          )}
          {parentId && (
            <button
              type="button"
              onClick={() => setTraceRoot(parentId)}
              className="text-[11px] font-semibold text-text-muted hover:text-gold transition-colors"
              title="Re-root at the parent hop"
            >
              ⊙ focus parent
            </button>
          )}
        </div>

        {/* Breadcrumb (prominent, clickable) */}
        <div className="flex items-center gap-1 flex-wrap mb-2 rounded border border-border-subtle/60 bg-surface/40 px-2 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-text-muted mr-1">Path</span>
          {breadcrumb.map((n, i) => (
            <span key={`${n.id}-${i}`} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => truncateTrace(i + 1)}
                className={`text-[11px] truncate max-w-[160px] transition-colors px-1.5 py-0.5 rounded ${
                  i === breadcrumb.length - 1
                    ? "text-text-primary font-semibold bg-accent/10"
                    : "text-text-muted hover:text-gold hover:bg-elevated"
                }`}
                title={n.name}
              >
                {n.name}
              </button>
              {i < breadcrumb.length - 1 && (
                <span className="text-text-muted text-[11px]">›</span>
              )}
            </span>
          ))}
        </div>

        {/* Wave-1 toolbar */}
        <div className="mb-2">
          <TraceControls
            packagesPresent={packagesPresent}
            searchResults={graph.nodes}
            onPickPathTarget={(id) => setPathTarget(id)}
          />
        </div>

        {/* Wave-3 debug toolbar */}
        <div className="mb-2">
          <DebugBar
            errorPathHopCount={errorPathIds.size}
            onExplainErrorPath={explainErrorPath}
            explainState={errExplain.status}
            explainPanel={
              <ExplainPanel
                state={errExplain}
                title="✦ Error path"
                onClose={resetErr}
                onAsk={askErr}
              />
            }
          />
        </div>

        {/* Feature 21: Watches panel */}
        {watches.length > 0 && (
          <div className="mb-2">
            <WatchesPanel
              watches={watches}
              hitCounts={watchHopCounts}
              onRemove={removeWatch}
              onJumpNext={jumpToWatch}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-base font-heading text-text-primary truncate" title={focusNode.name}>
              {rootNode && rootNode.id !== focusNode.id ? (
                <span className="text-text-muted text-sm">
                  {rootNode.name} <span className="mx-1">/</span>
                </span>
              ) : null}
              {focusNode.name}
            </div>
            <div className="text-[11px] text-text-muted">
              {pathTarget ? (
                <span>
                  path mode · {hops.length} hop{hops.length === 1 ? "" : "s"}
                  {pathHops && pathHops.length === 0 ? " · no path found" : ""}
                </span>
              ) : (
                <span>
                  {hops.length} hop{hops.length === 1 ? "" : "s"} · {totalCalls} call
                  {totalCalls === 1 ? "" : "s"} · {direction}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                selectNode(focusId);
                setViewMode("structural");
              }}
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary hover:border-border-medium transition-colors"
            >
              View in graph
            </button>
            <button
              type="button"
              onClick={() => {
                saveTour(focusNode.name, hops.map((h) => h.id));
                setTourSaved(true);
                window.setTimeout(() => setTourSaved(false), 1800);
              }}
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary hover:border-border-medium transition-colors"
              title="Save this trace as a tour (persists across restarts)"
            >
              {tourSaved ? "Saved ✓" : "Save tour"}
            </button>
            <button
              type="button"
              data-testid="snapshot-trace"
              onClick={() => {
                snapshotTrace(focusNode.name, currentIds);
                setSnapped(true);
                window.setTimeout(() => setSnapped(false), 1800);
              }}
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary hover:border-border-medium transition-colors"
              title="Snapshot this trace's structure (in-app capture; diff later)"
            >
              {snapped ? "Snapped 📌" : "📌 Snapshot"}
            </button>
            <button
              type="button"
              onClick={toggleBookmarksPanel}
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary hover:border-border-medium transition-colors"
              title="Open the Bookmarks / Investigation panel"
            >
              ★ Investigation
            </button>
            <button
              type="button"
              onClick={copyTrace}
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 transition-colors"
              title="Copy the trace (file:lineRange + name + summary) for pasting to Claude"
            >
              {copied ? "Copied ✓" : "Copy trace for Claude"}
            </button>
          </div>
        </div>
      </div>

      {/* Body: minimap rail + trace column */}
      <div className="p-5">
        <div className="max-w-7xl mx-auto flex gap-4">
          {/* Minimap rail */}
          {hops.length > 1 && (
            <div className="hidden lg:block w-52 shrink-0">
              <Minimap
                hops={hops}
                focusId={focusId}
                criticalIds={criticalIds}
                onPick={(id) => setTraceRoot(id)}
              />
            </div>
          )}

          {/* Trace column */}
          <div className="flex-1 min-w-0">
            {/* Feature 30: hops present in the snapshot but gone from this trace. */}
            {diff && diff.removed.length > 0 && (
              <div
                data-testid="diff-removed"
                className="mb-3 rounded-lg border border-[rgb(248,113,113)]/40 bg-[rgb(248,113,113)]/5 px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-[rgb(248,113,113)] mb-1.5">
                  − removed vs snapshot ({diff.removed.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {diff.removed.map((id) => {
                    const n = nodesById.get(id);
                    return (
                      <span
                        key={id}
                        className="text-[11px] font-mono px-2 py-1 rounded border border-[rgb(248,113,113)]/30 text-[rgb(248,113,113)]/90 line-through"
                        title={n ? lineLabel(n) : id}
                      >
                        {n?.name ?? id}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {pathTarget && pathHops && pathHops.length === 0 ? (
              <div className="max-w-lg mx-auto mt-8 text-center">
                <p className="text-text-secondary text-sm">
                  No call/import path from{" "}
                  <span className="font-mono">{focusNode.name}</span> to the chosen target.
                </p>
              </div>
            ) : noCallChain && layout === "nested" ? (
              <div className="max-w-lg mx-auto mt-8 text-center">
                <div className="mb-6 text-left">{renderHop(focusNode, 0)}</div>
                <p className="text-text-secondary text-sm">
                  No traced {direction} from this node — try the other direction, a
                  deeper depth, or pick a function in an analyzed package.
                </p>
              </div>
            ) : layout === "shape" ? (
              <ShapeView
                hops={hops}
                graph={graph}
                direction={direction}
                onPick={(id) => setTraceRoot(id)}
              />
            ) : layout === "flat" ? (
              <div className="space-y-2">
                {hops.map((node, i) => {
                  if (hiddenByPredicate(node)) return null;
                  const cls = classify(node);
                  const isCritical = criticalIds.has(node.id);
                  const dimmed = criticalOn && criticalIds.size > 0 && !isCritical;
                  if (cls !== "full") {
                    return (
                      <FoldedHopRow
                        key={`${node.id}-${i}`}
                        node={node}
                        index={i}
                        reason={cls === "muted" ? "muted" : "folded"}
                        onUnfold={() => toggleUnfold(node.id)}
                      />
                    );
                  }
                  return (
                    <div
                      key={`${node.id}-${i}`}
                      className={`flex items-center gap-2 rounded border px-3 py-2 transition-opacity ${
                        isCritical ? "border-accent ring-1 ring-accent/40" : "border-border-subtle"
                      } ${dimmed ? "opacity-40" : ""} bg-elevated/40`}
                      style={{ marginLeft: `${Math.min(i, 10) * 14}px` }}
                      ref={(el) => {
                        if (el) hopRefs.current.set(i, el as unknown as HTMLDivElement);
                      }}
                    >
                      <span className="text-[10px] font-mono text-text-muted shrink-0">{i + 1}</span>
                      <span
                        className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0"
                        style={{ color: nodeColorVar(node.type) }}
                      >
                        {node.type}
                      </span>
                      <span className="text-[12px] font-mono text-text-primary truncate flex-1" title={lineLabel(node)}>
                        {node.name}
                      </span>
                      {isCritical && <span className="text-accent text-[10px] shrink-0">◆</span>}
                      <button
                        type="button"
                        onClick={() => setTraceRoot(node.id)}
                        className="text-[10px] font-semibold text-gold hover:text-gold-bright shrink-0"
                        title="Focus this node"
                      >
                        ⊙
                      </button>
                      <button
                        type="button"
                        onClick={() => pushTrace(node.id)}
                        className="text-[10px] font-semibold text-accent hover:text-accent-bright shrink-0"
                        title="Step into"
                      >
                        ↳
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">{hops.map((node, i) => renderHop(node, i))}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

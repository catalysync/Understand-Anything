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
} from "./traceGraph";
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

function HopCode({
  node,
  accessToken,
  graph,
  pushTrace,
}: {
  node: GraphNode;
  accessToken: string;
  graph: KnowledgeGraph;
  pushTrace: (id: string) => void;
}) {
  const [state, setState] = useState<SourceState>({
    status: "idle",
    source: null,
    error: null,
  });

  useEffect(() => {
    if (!node.filePath) {
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
    fetch(fileContentUrl(node.filePath, accessToken), { signal: controller.signal })
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
  }, [accessToken, node.filePath]);

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

  return (
    <div className="max-h-[70vh] overflow-auto bg-root">
      <CodeBlock
        code={source.content}
        language={language}
        accessToken={accessToken}
        filePath={node.filePath}
        highlightedRange={range}
        windowStart={windowStart}
        windowEnd={windowEnd}
        graph={graph}
        currentNodeId={node.id}
        onJumpToNode={(targetId) => pushTrace(targetId)}
        fontSizeClass="text-[13px] leading-6"
      />
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
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showCallers, setShowCallers] = useState(false);
  const [bundleOpen, setBundleOpen] = useState<Record<string, boolean>>({});
  const color = nodeColorVar(node.type);
  const setTraceRoot = useDashboardStore((s) => s.setTraceRoot);
  const bundles = useMemo(() => bundleCalleesByPackage(graph, node.id), [graph, node.id]);
  const callers = useMemo(() => callersOf(graph, node.id), [graph, node.id]);
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
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  const teachGo = () => {
    if (!node.filePath || !node.lineRange) return;
    explainGo(node.filePath, node.lineRange[0], node.lineRange[1], node.lineRange[0]);
  };

  const totalCallees = bundles.reduce((acc, b) => acc + b.nodes.length, 0);

  return (
    <div className={`relative pl-6 transition-opacity ${dimmed ? "opacity-40" : ""}`} ref={registerRef}>
      {/* Connector rail */}
      <div className="absolute left-2 top-0 bottom-0 w-px bg-border-subtle" />
      <div
        className="absolute left-[3px] top-4 w-2.5 h-2.5 rounded-full border-2"
        style={{ borderColor: color, backgroundColor: "var(--color-surface, #1a1a1a)" }}
      />

      <div
        className={`rounded-lg border bg-elevated/60 overflow-hidden ${
          isCritical ? "border-accent ring-1 ring-accent/50" : "border-border-subtle"
        }`}
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
            </div>
            <div className="text-[11px] font-mono text-text-muted truncate" title={lineLabel(node)}>
              {lineLabel(node)}
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
        </div>

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

        {expanded && (
          <div className="border-t border-border-subtle">
            <HopCode node={node} accessToken={accessToken} graph={graph} pushTrace={pushTrace} />
          </div>
        )}

        {/* Outgoing calls — bundled by package when many into the same package */}
        {totalCallees > 0 && (
          <div className="px-3 py-2.5 border-t border-border-subtle bg-surface/40">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              Calls ({totalCallees}) — click to descend
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
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => pushTrace(t.id)}
                              className="text-[11px] px-2 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 hover:bg-accent/10 transition-colors font-mono"
                              title={lineLabel(t)}
                            >
                              {t.name} →
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                  );
                }
                return b.nodes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pushTrace(t.id)}
                    className="text-[11px] px-2 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 hover:bg-accent/10 transition-colors font-mono"
                    title={lineLabel(t)}
                  >
                    {t.name} →
                  </button>
                ));
              })}
            </div>
          </div>
        )}
      </div>
    </div>
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

  const [copied, setCopied] = useState(false);
  const [tourSaved, setTourSaved] = useState(false);
  const hopRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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

  const renderHop = (node: GraphNode, i: number) => {
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

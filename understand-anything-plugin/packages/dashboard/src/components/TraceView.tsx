import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import CodeBlock from "./CodeBlock";
import { useExplain } from "./useCodeAssist";
import ExplainPanel from "./ExplainPanel";
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
 * Build the ordered call chain from a focus node by walking OUTGOING `calls`
 * edges (with `contains` used to surface a file's functions) up to `maxDepth`.
 * Dedups by id and preserves first-visit order.
 */
function buildTrace(
  graph: KnowledgeGraph,
  focusId: string,
  maxDepth = 4,
): GraphNode[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const ordered: GraphNode[] = [];
  const seen = new Set<string>();

  const visit = (id: string, depth: number) => {
    if (seen.has(id) || depth > maxDepth) return;
    const node = nodesById.get(id);
    if (!node) return;
    seen.add(id);
    ordered.push(node);
    // Follow calls first (primary), then contains to surface functions.
    const next = graph.edges
      .filter(
        (e) =>
          e.source === id &&
          (e.type === "calls" || e.type === "contains"),
      )
      // calls before contains so the call path reads naturally
      .sort((a, b) => (a.type === b.type ? 0 : a.type === "calls" ? -1 : 1));
    for (const e of next) visit(e.target, depth + 1);
  };

  visit(focusId, 0);
  return ordered;
}

/** Outgoing `calls` targets for a single node (for the descend chips). */
function callTargets(graph: KnowledgeGraph, id: string): GraphNode[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.source === id && e.type === "calls")
    .map((e) => nodesById.get(e.target))
    .filter((n): n is GraphNode => n !== undefined);
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

  // Only render a window around the highlighted range to stay light.
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

function HopCard({
  node,
  index,
  defaultExpanded,
  accessToken,
  graph,
  pushTrace,
}: {
  node: GraphNode;
  index: number;
  defaultExpanded: boolean;
  accessToken: string;
  graph: KnowledgeGraph;
  pushTrace: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const color = nodeColorVar(node.type);
  const targets = callTargets(graph, node.id);
  const { state: goNote, explain: explainGo, askFollowUp: askGo, reset: resetGo } =
    useExplain(accessToken, node.id);
  const toggleBookmark = useDashboardStore((s) => s.toggleBookmark);
  // Select stable references (the arrays), then derive with useMemo so we
  // don't return a fresh array/boolean from the selector each render (which
  // would trigger zustand's getSnapshot warning + an update loop).
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

  return (
    <div className="relative pl-6">
      {/* Connector rail */}
      <div className="absolute left-2 top-0 bottom-0 w-px bg-border-subtle" />
      <div
        className="absolute left-[3px] top-4 w-2.5 h-2.5 rounded-full border-2"
        style={{ borderColor: color, backgroundColor: "var(--color-surface, #1a1a1a)" }}
      />

      <div className="rounded-lg border border-border-subtle bg-elevated/60 overflow-hidden">
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
            <div className="text-sm font-heading text-text-primary truncate" title={node.name}>
              {node.name}
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

        {/* Explanation (pre-generated narration — no API) */}
        <div className="px-3 pb-2.5 -mt-1">
          <p className="text-[12px] text-text-secondary leading-relaxed">
            {node.summary?.trim() ? node.summary : "—"}
          </p>
          {/* Pinned annotations for this hop */}
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

          {/* Note input */}
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

          {/* Go note — lazy, on click, calls /explain.json for this hop's lineRange */}
          {node.filePath && node.lineRange && (
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
                <ExplainPanel
                  state={goNote}
                  title="✦ Go note"
                  onClose={resetGo}
                  onAsk={askGo}
                />
              )}
            </div>
          )}
        </div>

        {expanded && (
          <>
            <div className="border-t border-border-subtle">
              <HopCode node={node} accessToken={accessToken} graph={graph} pushTrace={pushTrace} />
            </div>
          </>
        )}

        {/* Outgoing call chips */}
        {targets.length > 0 && (
          <div className="px-3 py-2.5 border-t border-border-subtle bg-surface/40">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              Calls ({targets.length}) — click to descend
            </div>
            <div className="flex flex-wrap gap-1.5">
              {targets.map((t) => (
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
            </div>
          </div>
        )}
      </div>
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
  const selectNode = useDashboardStore((s) => s.selectNode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const saveTour = useDashboardStore((s) => s.saveTour);
  const toggleBookmarksPanel = useDashboardStore((s) => s.toggleBookmarksPanel);
  const [copied, setCopied] = useState(false);
  const [tourSaved, setTourSaved] = useState(false);

  const focusId = traceStack.length > 0 ? traceStack[traceStack.length - 1] : traceRoot;

  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );

  const hops = useMemo(() => {
    if (!graph || !focusId) return [];
    return buildTrace(graph, focusId);
  }, [graph, focusId]);

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
  const directCalls = callTargets(graph, focusId);
  const totalCalls = hops.reduce((acc, h) => acc + callTargets(graph, h.id).length, 0);

  const breadcrumb = traceStack
    .map((id) => nodesById.get(id))
    .filter((n): n is GraphNode => n !== undefined);

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
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {breadcrumb.map((n, i) => (
            <span key={`${n.id}-${i}`} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => truncateTrace(i + 1)}
                className={`text-[11px] truncate max-w-[160px] transition-colors ${
                  i === breadcrumb.length - 1
                    ? "text-text-primary font-medium"
                    : "text-text-muted hover:text-gold"
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
              {hops.length} hop{hops.length === 1 ? "" : "s"} · {totalCalls} call
              {totalCalls === 1 ? "" : "s"}
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

      {/* Body */}
      <div className="p-5">
        {directCalls.length === 0 ? (
          <div className="max-w-lg mx-auto mt-8 text-center">
            {/* Still show the focus node itself so the user sees something */}
            <div className="mb-6 text-left">
              <HopCard
                node={focusNode}
                index={0}
                defaultExpanded
                accessToken={accessToken}
                graph={graph}
                pushTrace={pushTrace}
              />
            </div>
            <p className="text-text-secondary text-sm">
              No traced calls from this node — pick a function in an analyzed
              package (e.g. <span className="font-mono">httpx/</span>,{" "}
              <span className="font-mono">providers/</span>).
            </p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-3">
            {hops.map((node, i) => (
              <HopCard
                key={`${node.id}-${i}`}
                node={node}
                index={i}
                defaultExpanded={i < 2}
                accessToken={accessToken}
                graph={graph}
                pushTrace={pushTrace}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

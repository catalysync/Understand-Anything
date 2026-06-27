// 300-series items 114-121: the DEEP MULTI-TAB node inspector.
//
// When a node is selected, the left sidebar's Overview surfaces a tabbed
// inspector for that node. Every tab is graph-data-driven: tabs with no data
// hide (or render an honest empty hint). The tabs are:
//   • Overview  — the existing NodeInfo panel (unchanged).
//   • Structure — the node's internal symbol tree (its `contains` children),
//                 sortable + filterable.
//   • Usages    — callers/callees/importers grouped by edge kind then directory,
//                 collapsible with counts; each row jumps via focusEntity.
//   • Tests     — covering tests + coverage flag (reuses coverage selectors).
//   • Ops       — used_by / data / error / observability summary.
//   • Computed  — derived metrics (fan-in/out, complexity, dep depth, layer,
//                 escaping errors, critical-path) each expandable to a "why".
//   • History / Owners — require git / CODEOWNERS metadata which is NOT in the
//                 graph; rendered with an honest "not indexed" empty state.
//
// Per-node tab selection is local + persisted to localStorage.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useDashboardStore } from "../store";
import NodeInfo from "./NodeInfo";
import {
  symbolChildren,
  usagesForNode,
  coveringTestsForNode,
  codeUnderTest,
  opsLayerForNode,
  observabilityFor,
  uncaughtErrorsFor,
  computedMetricsFor,
  nodeTypeIcon,
  CODE_TYPES,
} from "../utils/opsLayer";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

type DeepTab = "overview" | "structure" | "usages" | "tests" | "ops" | "computed" | "history" | "owners";

const DEEP_TAB_KEY = "ua-node-deeptab-v1";
const ALL_DEEP_TABS: DeepTab[] = [
  "overview", "structure", "usages", "tests", "ops", "computed", "history", "owners",
];

function readDeepTab(): DeepTab {
  if (typeof window === "undefined") return "overview";
  try {
    const v = window.localStorage.getItem(DEEP_TAB_KEY) as DeepTab | null;
    if (v && ALL_DEEP_TABS.includes(v)) return v;
  } catch { /* ignore */ }
  return "overview";
}
function persistDeepTab(tab: DeepTab): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DEEP_TAB_KEY, tab); } catch { /* ignore */ }
}

const TAB_LABELS: Record<DeepTab, string> = {
  overview: "Overview",
  structure: "Structure",
  usages: "Usages",
  tests: "Tests",
  ops: "Ops",
  computed: "Computed",
  history: "History",
  owners: "Owners",
};

function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="px-5 py-8 text-center text-[11px] text-text-muted leading-relaxed">{children}</div>;
}

// ── Structure tab ──────────────────────────────────────────────────────────
function StructureTab({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "type" | "complexity">("name");

  const children = useMemo(() => symbolChildren(graph, node.id), [graph, node.id]);
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = children;
    if (q) out = out.filter((c) => c.node.name.toLowerCase().includes(q) || c.kind.toLowerCase().includes(q));
    const cxRank: Record<string, number> = { simple: 0, moderate: 1, complex: 2 };
    return [...out].sort((a, b) => {
      if (sortBy === "type") return a.kind.localeCompare(b.kind) || a.node.name.localeCompare(b.node.name);
      if (sortBy === "complexity") return (cxRank[b.node.complexity] ?? 0) - (cxRank[a.node.complexity] ?? 0) || a.node.name.localeCompare(b.node.name);
      return a.node.name.localeCompare(b.node.name);
    });
  }, [children, filter, sortBy]);

  if (children.length === 0) {
    return <EmptyHint>This node has no internal symbols (no <span className="font-mono">contains</span> children).</EmptyHint>;
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter symbols…"
          className="flex-1 bg-surface text-text-primary text-xs rounded-md px-2.5 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="bg-surface text-text-secondary text-[11px] rounded-md px-2 py-1.5 border border-border-subtle focus:outline-none"
          title="Sort symbols"
        >
          <option value="name">Name</option>
          <option value="type">Type</option>
          <option value="complexity">Complexity</option>
        </select>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted">
        {rows.length} symbol{rows.length === 1 ? "" : "s"}
      </div>
      <div className="space-y-1">
        {rows.map((c) => (
          <button
            key={c.node.id}
            type="button"
            onClick={() => focusEntity(c.node.id, { view: "structural" })}
            className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-accent/40 text-left transition-colors"
            title={c.node.summary || c.node.name}
          >
            <span className="shrink-0" aria-hidden>{nodeTypeIcon(c.kind)}</span>
            <span className="text-[8px] font-semibold uppercase tracking-wider text-text-muted shrink-0">{c.kind}</span>
            <span className="text-text-primary truncate flex-1">{c.node.name}</span>
            {c.node.complexity === "complex" && (
              <span className="text-[8px] font-bold uppercase px-1 rounded bg-[#c97070]/15 text-[#c97070] shrink-0">cx</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Usages tab ─────────────────────────────────────────────────────────────
function UsagesTab({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const groups = useMemo(() => usagesForNode(graph, node.id), [graph, node.id]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });

  if (groups.length === 0) {
    return <EmptyHint>No call / import / implements relationships recorded for this node.</EmptyHint>;
  }

  return (
    <div className="px-4 py-3 space-y-3">
      {groups.map((g) => {
        const gkey = `${g.edgeType}-${g.label}`;
        const gCollapsed = collapsed.has(gkey);
        return (
          <div key={gkey}>
            <button
              type="button"
              onClick={() => toggle(gkey)}
              className="w-full flex items-center gap-2 text-[11px] font-semibold text-accent uppercase tracking-wider mb-1.5"
            >
              <span className="opacity-60">{gCollapsed ? "▸" : "▾"}</span>
              <span className="flex-1 text-left">{g.label}</span>
              <span className="font-mono text-text-muted">{g.total}</span>
            </button>
            {!gCollapsed && (
              <div className="space-y-2 pl-2">
                {g.byDir.map((d) => {
                  const dkey = `${gkey}::${d.dir}`;
                  const dCollapsed = collapsed.has(dkey);
                  return (
                    <div key={dkey}>
                      <button
                        type="button"
                        onClick={() => toggle(dkey)}
                        className="w-full flex items-center gap-1.5 text-[10px] text-text-muted mb-1 hover:text-text-secondary transition-colors"
                        title={d.dir}
                      >
                        <span className="opacity-60">{dCollapsed ? "▸" : "▾"}</span>
                        <span className="font-mono truncate flex-1 text-left">{d.dir || "—"}</span>
                        <span className="shrink-0">{d.rows.length}</span>
                      </button>
                      {!dCollapsed && (
                        <div className="space-y-1">
                          {d.rows.map((r) => (
                            <button
                              key={`${dkey}-${r.node.id}`}
                              type="button"
                              onClick={() => focusEntity(r.node.id, { view: "structural" })}
                              className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-accent/40 text-left transition-colors"
                              title={`Jump to ${r.node.name}`}
                            >
                              <span className="shrink-0 text-[10px] opacity-60" aria-hidden>{r.outgoing ? "→" : "←"}</span>
                              <span className="text-text-primary truncate flex-1">{r.node.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Tests tab ──────────────────────────────────────────────────────────────
function TestsTab({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const isCode = CODE_TYPES.has(node.type);
  const isTest = node.type === "test" || node.type === "suite";
  const covering = useMemo(() => (isCode ? coveringTestsForNode(graph, node.id) : []), [graph, node.id, isCode]);
  const underTest = useMemo(() => (isTest ? codeUnderTest(graph, node.id) : []), [graph, node.id, isTest]);

  if (covering.length === 0 && underTest.length === 0) {
    return <EmptyHint>No tests cover this node yet — enrich the graph with <span className="font-mono">tested_by</span> / <span className="font-mono">covers</span> edges.</EmptyHint>;
  }

  return (
    <div className="px-4 py-3 space-y-3">
      {isCode && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-node-test" aria-hidden>✓</span>
            <span className="text-xs text-text-secondary">
              {covering.length === 0 ? "Uncovered" : `${covering.length} test${covering.length === 1 ? "" : "s"} cover this`}
            </span>
            <span
              className={`ml-auto text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${covering.length > 0 ? "bg-node-test/15 text-node-test" : "bg-[#c97070]/15 text-[#c97070]"}`}
            >
              {covering.length > 0 ? "covered" : "uncovered"}
            </span>
          </div>
          <div className="space-y-1">
            {covering.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => focusEntity(t.id, { view: "structural" })}
                className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-node-test/40 text-left transition-colors"
              >
                <span className="text-node-test shrink-0" aria-hidden>✓</span>
                <span className="text-text-primary truncate flex-1">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {isTest && underTest.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
            Code under test ({underTest.length})
          </div>
          <div className="space-y-1">
            {underTest.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => focusEntity(c.id, { view: "structural" })}
                className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-accent/40 text-left transition-colors"
              >
                <span className="shrink-0" aria-hidden>{nodeTypeIcon(c.type)}</span>
                <span className="text-text-primary truncate flex-1">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ops tab ────────────────────────────────────────────────────────────────
function OpsTab({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const groups = useMemo(() => opsLayerForNode(graph, node.id), [graph, node.id]);
  const obs = useMemo(() => observabilityFor(graph, node.id), [graph, node.id]);
  const errors = useMemo(() => (CODE_TYPES.has(node.type) ? uncaughtErrorsFor(graph, node.id) : []), [graph, node.id]);

  const obsTotal = obs.logs.length + obs.spans.length + obs.metrics.length + obs.alerts.length;
  if (groups.length === 0 && obsTotal === 0 && errors.length === 0) {
    return <EmptyHint>No operations-layer connections (routes, data, errors, telemetry, ownership) for this node.</EmptyHint>;
  }

  return (
    <div className="px-4 py-3 space-y-4">
      {groups.map((g) => (
        <div key={`${g.label}-${g.edgeType}`}>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
            {g.label} ({g.rows.length})
          </div>
          <div className="space-y-1">
            {g.rows.map((r) => (
              <button
                key={`${g.edgeType}-${r.node.id}`}
                type="button"
                onClick={() => focusEntity(r.node.id)}
                className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-accent/40 text-left transition-colors"
              >
                <span className="shrink-0" aria-hidden>{nodeTypeIcon(r.node.type)}</span>
                <span className="text-text-primary truncate flex-1">{r.node.name}</span>
                <span className="text-[8px] uppercase tracking-wider text-text-muted shrink-0">{r.node.type}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {errors.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-node-error mb-1.5">
            Errors that escape ({errors.length})
          </div>
          <div className="space-y-1">
            {errors.map((u) => (
              <button
                key={u.error.id}
                type="button"
                onClick={() => focusEntity(u.error.id, { view: "structural" })}
                className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-node-error/40 text-left transition-colors"
              >
                <span className="text-[#d35d6e] shrink-0" aria-hidden>✕</span>
                <span className="text-text-primary truncate flex-1">{u.error.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {obsTotal > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-node-observability mb-1.5">
            Telemetry ({obsTotal})
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            {obs.logs.length > 0 && <span className="px-2 py-0.5 rounded bg-node-observability/10 text-node-observability border border-node-observability/30">{obs.logs.length} logs</span>}
            {obs.spans.length > 0 && <span className="px-2 py-0.5 rounded bg-node-observability/10 text-node-observability border border-node-observability/30">{obs.spans.length} spans</span>}
            {obs.metrics.length > 0 && <span className="px-2 py-0.5 rounded bg-node-observability/10 text-node-observability border border-node-observability/30">{obs.metrics.length} metrics</span>}
            {obs.alerts.length > 0 && <span className="px-2 py-0.5 rounded bg-[#c97070]/10 text-[#c97070] border border-[#c97070]/30">{obs.alerts.length} alerts</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Computed tab ───────────────────────────────────────────────────────────
function ComputedTab({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const m = useMemo(() => computedMetricsFor(graph, node.id), [graph, node.id]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (!m) return <EmptyHint>No metrics available for this node.</EmptyHint>;

  const metrics: { key: string; label: string; value: string; why: string }[] = [
    { key: "fanIn", label: "Fan-in", value: `${m.callFanIn} calls (${m.fanIn} total)`, why: "Distinct callers via incoming `calls` edges (and all incoming edges of any type)." },
    { key: "fanOut", label: "Fan-out", value: `${m.callFanOut} calls (${m.fanOut} total)`, why: "Distinct callees via outgoing `calls` edges (and all outgoing edges of any type)." },
    { key: "complexity", label: "Complexity", value: m.complexity, why: "The node's analyzer-assigned complexity bucket (simple / moderate / complex)." },
    { key: "depDepth", label: "Transitive dep depth", value: String(m.depDepth), why: "Longest downstream chain of `calls` edges from this node (cycle-safe)." },
    { key: "layer", label: "Layer", value: m.layer ?? "—", why: "The architectural layer this node was assigned to during analysis." },
    { key: "escaping", label: "Errors that escape", value: String(m.escapingErrors), why: "Distinct error types raised transitively (via `calls`/`raises`) and not caught en route by a `handles` node." },
    { key: "critical", label: "On a critical path", value: m.onCriticalPath ? `yes (len ${m.criticalPathLen})` : "no", why: "True when the node sits on a non-trivial longest call chain — its downstream `calls` depth is ≥ 1." },
  ];

  return (
    <div className="px-4 py-3 space-y-1.5">
      {metrics.map((row) => {
        const open = openKey === row.key;
        return (
          <div key={row.key} className="bg-elevated rounded-lg border border-border-subtle overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : row.key)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/5 transition-colors"
            >
              <span className="opacity-50 text-[10px]">{open ? "▾" : "▸"}</span>
              <span className="text-text-secondary flex-1">{row.label}</span>
              <span className="font-mono text-text-primary">{row.value}</span>
            </button>
            {open && (
              <div className="px-3 pb-2.5 pt-0.5 text-[11px] text-text-muted leading-relaxed border-t border-border-subtle/50">
                {row.why}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main tabbed inspector ──────────────────────────────────────────────────
export default function NodeInspectorTabs() {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const [tab, setTab] = useState<DeepTab>(readDeepTab);

  const activeGraph = viewMode === "domain" && domainGraph ? domainGraph : graph;
  const node = activeGraph?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // Which tabs have data? (Overview always; History/Owners always show honest
  // empty states; the rest hide when empty.)
  const tabsWithData = useMemo(() => {
    const set = new Set<DeepTab>(["overview", "history", "owners", "computed"]);
    if (!activeGraph || !node) return set;
    if (symbolChildren(activeGraph, node.id).length > 0) set.add("structure");
    if (usagesForNode(activeGraph, node.id).length > 0) set.add("usages");
    const isCode = CODE_TYPES.has(node.type);
    const isTest = node.type === "test" || node.type === "suite";
    if ((isCode && coveringTestsForNode(activeGraph, node.id).length > 0) ||
        (isTest && codeUnderTest(activeGraph, node.id).length > 0)) set.add("tests");
    const obs = observabilityFor(activeGraph, node.id);
    const obsTotal = obs.logs.length + obs.spans.length + obs.metrics.length + obs.alerts.length;
    if (opsLayerForNode(activeGraph, node.id).length > 0 || obsTotal > 0 ||
        (isCode && uncaughtErrorsFor(activeGraph, node.id).length > 0)) set.add("ops");
    return set;
  }, [activeGraph, node]);

  const visibleTabs = ALL_DEEP_TABS.filter((t) => tabsWithData.has(t));

  // If the persisted tab is no longer visible, fall back to overview.
  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab("overview");
      persistDeepTab("overview");
    }
  }, [visibleTabs, tab]);

  const setTabPersisted = (next: DeepTab) => {
    setTab(next);
    persistDeepTab(next);
  };

  if (!node || !activeGraph) return <NodeInfo />;

  return (
    <div className="flex flex-col min-h-0">
      {/* Deep-tab strip */}
      <div className="flex items-center gap-0.5 px-2 pt-2 pb-1 overflow-x-auto border-b border-border-subtle bg-surface/60 shrink-0">
        {visibleTabs.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTabPersisted(tb)}
            className={`px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
              tab === tb
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text-primary hover:bg-elevated"
            }`}
          >
            {TAB_LABELS[tb]}
          </button>
        ))}
      </div>

      <div className="min-h-0">
        {tab === "overview" && <NodeInfo />}
        {tab === "structure" && <StructureTab node={node} graph={activeGraph} />}
        {tab === "usages" && <UsagesTab node={node} graph={activeGraph} />}
        {tab === "tests" && <TestsTab node={node} graph={activeGraph} />}
        {tab === "ops" && <OpsTab node={node} graph={activeGraph} />}
        {tab === "computed" && <ComputedTab node={node} graph={activeGraph} />}
        {tab === "history" && (
          <EmptyHint>
            Commit history requires git metadata, which is not indexed in the knowledge graph.
            <br /><span className="opacity-70">Run <span className="font-mono">git log</span> on <span className="font-mono">{node.filePath ?? "this file"}</span> to view it.</span>
          </EmptyHint>
        )}
        {tab === "owners" && (
          <EmptyHint>
            Code ownership requires a <span className="font-mono">CODEOWNERS</span> file / git blame, which is not indexed in the knowledge graph.
          </EmptyHint>
        )}
      </div>
    </div>
  );
}

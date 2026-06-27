// Layout ergonomics: a deeper, sectioned/tabbed left inspector.
//
// Composes the existing panels rather than rewriting them:
//   • Overview  — NodeInfo (when a node is selected) → ProjectOverview, plus an
//                 "Insights" block: layers breakdown w/ file counts, top hubs,
//                 and entry-point candidates (all click-to-navigate).
//   • Files     — FileExplorer (file tree synced to selection).
//   • Saved     — inline node search, recents, pinned destinations, and a
//                 launcher for the full Bookmarks / Investigation panel.
//
// Tab state is local + persisted to localStorage (the server workspace
// whitelist drops unknown keys, so layout state lives client-side). Selecting a
// node auto-switches to Overview so the node inspector is visible.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import NodeInfo from "./NodeInfo";
import ProjectOverview from "./ProjectOverview";
import FileExplorer from "./FileExplorer";

const LearnPanel = lazy(() => import("./LearnPanel"));

type Tab = "overview" | "files" | "saved";
const TAB_KEY = "ua-sidebar-tab-v1";
const ALL_TABS: Tab[] = ["overview", "files", "saved"];

function readTab(): Tab {
  if (typeof window === "undefined") return "overview";
  try {
    const v = window.localStorage.getItem(TAB_KEY) as Tab | null;
    if (v && ALL_TABS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "overview";
}

function persistTab(tab: Tab): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

/** Project-level insights derived from the graph: layers, hubs, entry points. */
function InsightsBlock() {
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);

  const insights = useMemo(() => {
    if (!graph) return null;
    const { nodes, edges, layers } = graph;
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // Degree maps (in/out).
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    for (const e of edges) {
      outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    }

    // Layers with file counts (count nodes that resolve to a file path).
    const layerRows = layers.map((l) => {
      let fileCount = 0;
      for (const id of l.nodeIds) {
        const n = byId.get(id);
        if (n?.filePath) fileCount += 1;
      }
      return { id: l.id, name: l.name, total: l.nodeIds.length, fileCount };
    });

    // Top hubs by total degree.
    const hubs = nodes
      .map((n) => ({
        id: n.id,
        name: n.name,
        degree: (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0),
      }))
      .filter((h) => h.degree > 0)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 6);

    // Entry-point candidates: highest fan-in nodes (callers point at them).
    const entries = nodes
      .map((n) => ({ id: n.id, name: n.name, fanIn: inDeg.get(n.id) ?? 0 }))
      .filter((e) => e.fanIn > 0)
      .sort((a, b) => a.fanIn - b.fanIn) // fewest incoming → more "entry-like"
      .slice(0, 5);

    return { layerRows, hubs, entries };
  }, [graph]);

  if (!insights) return null;

  return (
    <div className="space-y-5 px-5 pb-6">
      {/* Layers breakdown */}
      {insights.layerRows.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            Layers
          </h3>
          <div className="space-y-1.5">
            {insights.layerRows.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle"
                title={`${l.total} nodes · ${l.fileCount} files`}
              >
                <span className="flex-1 text-text-secondary truncate">{l.name}</span>
                <span className="font-mono text-text-muted shrink-0">
                  {l.fileCount}
                  <span className="opacity-50">/{l.total}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top hubs */}
      {insights.hubs.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            Top hubs
          </h3>
          <div className="space-y-1">
            {insights.hubs.map((h, idx) => (
              <button
                key={h.id}
                type="button"
                onClick={() => focusEntity(h.id, { view: "structural" })}
                className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-accent/40 transition-colors text-left"
                title={`Focus ${h.name} (degree ${h.degree})`}
              >
                <span className="w-4 h-4 shrink-0 rounded-full bg-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
                  {idx + 1}
                </span>
                <span className="flex-1 text-text-primary truncate">{h.name}</span>
                <span className="font-mono text-text-muted shrink-0">{h.degree}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Entry-point candidates */}
      {insights.entries.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            Entry points
          </h3>
          <div className="space-y-1">
            {insights.entries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => navigateToNode(e.id)}
                className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle hover:border-accent/40 transition-colors text-left"
                title={`Open ${e.name} (fan-in ${e.fanIn})`}
              >
                <span className="text-accent shrink-0" aria-hidden>
                  ◎
                </span>
                <span className="flex-1 text-text-primary truncate">{e.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Saved tab: inline search, recents, pinned destinations, bookmarks launcher. */
function SavedTab() {
  const graph = useDashboardStore((s) => s.graph);
  const destinations = useDashboardStore((s) => s.destinations);
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const toggleBookmarksPanel = useDashboardStore((s) => s.toggleBookmarksPanel);
  const togglePinnedDestination = useDashboardStore((s) => s.togglePinnedDestination);
  const bookmarks = useDashboardStore((s) => s.workspace.bookmarks);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !graph) return [];
    return graph.nodes
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          (n.filePath ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, graph]);

  return (
    <div className="px-4 py-3 space-y-5">
      {/* Inline search */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes by name or path…"
          className="w-full bg-surface text-text-primary text-xs rounded-md px-2.5 py-2 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
        />
        {query.trim() && (
          <div className="mt-2 space-y-1">
            {results.length === 0 ? (
              <div className="text-[11px] text-text-muted px-1">No matches.</div>
            ) : (
              results.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => navigateToNode(n.id)}
                  className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-elevated transition-colors text-left"
                  title={n.filePath ?? n.name}
                >
                  <span className="flex-1 text-text-primary truncate">{n.name}</span>
                  <span className="text-[10px] text-text-muted shrink-0 capitalize">
                    {n.type}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Bookmarks launcher */}
      <button
        type="button"
        onClick={toggleBookmarksPanel}
        className="w-full bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/30 text-xs font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        <span aria-hidden>★</span> Bookmarks / Investigation
        <span className="text-text-muted font-mono">({bookmarks.length})</span>
      </button>

      {/* Pinned destinations */}
      {destinations.pinned.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            Pinned
          </h3>
          <div className="space-y-1">
            {destinations.pinned.map((p) => (
              <div
                key={p.nodeId}
                className="flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle"
              >
                <button
                  type="button"
                  onClick={() => navigateToNode(p.nodeId)}
                  className="flex-1 text-text-primary truncate text-left hover:text-accent transition-colors"
                  title={nodesById.get(p.nodeId)?.filePath ?? p.name}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => togglePinnedDestination(p.nodeId)}
                  className="text-text-muted hover:text-text-primary shrink-0"
                  title="Unpin"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recents */}
      <div>
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
          Recent
        </h3>
        {destinations.recent.length === 0 ? (
          <div className="text-[11px] text-text-muted">
            Nodes you focus will show up here.
          </div>
        ) : (
          <div className="space-y-1">
            {destinations.recent.map((r) => (
              <button
                key={r.nodeId}
                type="button"
                onClick={() => navigateToNode(r.nodeId)}
                className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-elevated transition-colors text-left"
                title={nodesById.get(r.nodeId)?.filePath ?? r.name}
              >
                <span className="flex-1 text-text-primary truncate">{r.name}</span>
                <span className="text-[10px] text-text-muted shrink-0 capitalize">
                  {r.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SidebarInspector() {
  const { t } = useI18n();
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const persona = useDashboardStore((s) => s.persona);
  const [tab, setTab] = useState<Tab>(readTab);

  // Selecting a node should reveal the node inspector (lives in Overview).
  useEffect(() => {
    if (selectedNodeId) {
      setTab("overview");
      persistTab("overview");
    }
  }, [selectedNodeId]);

  const setTabPersisted = (next: Tab) => {
    setTab(next);
    persistTab(next);
  };

  const isLearnMode = tourActive || persona === "junior";

  const tabLabels: Record<Tab, string> = {
    overview: t.sidebar.info,
    files: t.sidebar.files,
    saved: "Saved",
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Tab strip */}
      <div className="flex items-center gap-1 p-2 border-b border-border-subtle bg-surface shrink-0">
        {ALL_TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTabPersisted(tb)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              tab === tb
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text-primary hover:bg-elevated"
            }`}
          >
            {tabLabels[tb]}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "files" ? (
          <FileExplorer />
        ) : tab === "saved" ? (
          <SavedTab />
        ) : (
          <>
            {selectedNodeId && <NodeInfo />}
            {isLearnMode && (
              <Suspense fallback={null}>
                <LearnPanel />
              </Suspense>
            )}
            {!selectedNodeId && !isLearnMode && (
              <>
                <ProjectOverview />
                <InsightsBlock />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

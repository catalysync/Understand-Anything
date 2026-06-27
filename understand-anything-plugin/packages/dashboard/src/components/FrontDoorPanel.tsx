// ── Front Door panel (300-series items 1-3, 12-14) ─────────────────────────
//
// Three sub-views over the operations-layer graph:
//   • Index    — every entrypoint node (endpoint/route/command/event/schedule)
//                grouped by kind, filterable, each row → focus its handler.
//   • API map  — a method · path · handler table for route/endpoint nodes.
//   • Reach    — reachability / dead-code overlay controls (drive GraphView).
//
// All views degrade to clean empty-states when the operations-layer graph is
// sparse (it is enriched in parallel). No data is fabricated.
import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import {
  entrypointIndex,
  routeMap,
  nodeTypeIcon,
  allEntrypointIds,
  type EntrypointEntry,
} from "../utils/opsLayer";

type DoorView = "index" | "api" | "reach";
const DOOR_VIEW_KEY = "ua-frontdoor-view-v1";

function readDoorView(): DoorView {
  if (typeof window === "undefined") return "index";
  try {
    const v = window.localStorage.getItem(DOOR_VIEW_KEY);
    if (v === "index" || v === "api" || v === "reach") return v;
  } catch { /* ignore */ }
  return "index";
}

const EMPTY_HINT =
  "No entrypoints indexed yet — run enrichment / re-index with the operations-layer analyzer.";

/** A single entrypoint row: focus the handler (preferred) or the entry node. */
function EntrypointRow({ entry }: { entry: EntrypointEntry }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);
  const setReachabilityRoot = useDashboardStore((s) => s.setReachabilityRoot);
  const target = entry.handler ?? entry.node;

  return (
    <div className="text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle flex items-center gap-2 group">
      <span className="shrink-0" aria-hidden>{nodeTypeIcon(entry.node.type)}</span>
      {entry.method && (
        <span className="font-mono text-[10px] font-semibold text-node-endpoint shrink-0 w-12">
          {entry.method}
        </span>
      )}
      <button
        type="button"
        onClick={() => focusEntity(target.id)}
        className="flex-1 min-w-0 text-left text-text-primary truncate hover:text-accent transition-colors"
        title={entry.handler ? `Focus handler: ${entry.handler.name}` : `Focus ${entry.node.name}`}
      >
        <span className="font-mono">{entry.path ?? entry.node.name}</span>
        {entry.handler && (
          <span className="text-text-muted ml-1.5">→ {entry.handler.name}</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setReachabilityRoot(entry.node.id)}
        className="shrink-0 opacity-0 group-hover:opacity-100 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/30 text-accent hover:text-accent-bright transition-all"
        title="Highlight everything reachable from this entrypoint"
      >
        reach
      </button>
      <button
        type="button"
        onClick={() => startTraceAt(target.id)}
        className="shrink-0 opacity-0 group-hover:opacity-100 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/30 text-accent hover:text-accent-bright transition-all"
        title="Trace from here"
      >
        ▶
      </button>
    </div>
  );
}

/**
 * 300-series item 28: routes grouped by their domain (resolved via the
 * handler file → domain step). Routes with no resolvable domain fall into an
 * "Unmapped" bucket. Only rendered when "by domain" is toggled on.
 */
function DomainGroupedView({ filter }: { filter: string }) {
  const graph = useDashboardStore((s) => s.graph);
  const nodeIdToDomainStep = useDashboardStore((s) => s.nodeIdToDomainStep);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const setViewMode = useDashboardStore((s) => s.setViewMode);

  const buckets = useMemo(() => {
    if (!graph) return [];
    const flat = entrypointIndex(graph).flatMap((g) => g.entries);
    const byDomain = new Map<
      string,
      { domainId: string | null; domainName: string; flowNames: Set<string>; entries: EntrypointEntry[] }
    >();
    for (const e of flat) {
      const handler = e.handler;
      const ref = handler ? nodeIdToDomainStep.get(handler.id) : undefined;
      const key = ref ? ref.domainId : "__unmapped__";
      let b = byDomain.get(key);
      if (!b) {
        b = {
          domainId: ref ? ref.domainId : null,
          domainName: ref ? ref.domainName : "Unmapped",
          flowNames: new Set<string>(),
          entries: [],
        };
        byDomain.set(key, b);
      }
      if (ref) b.flowNames.add(ref.flowName);
      b.entries.push(e);
    }
    // Mapped domains first (alpha), unmapped last.
    return [...byDomain.values()].sort((a, b) => {
      if (a.domainId && !b.domainId) return -1;
      if (!a.domainId && b.domainId) return 1;
      return a.domainName.localeCompare(b.domainName);
    });
  }, [graph, nodeIdToDomainStep]);

  const q = filter.trim().toLowerCase();
  const filtered = buckets
    .map((b) => ({
      ...b,
      entries: q
        ? b.entries.filter(
            (e) =>
              e.node.name.toLowerCase().includes(q) ||
              (e.path ?? "").toLowerCase().includes(q) ||
              (e.handler?.name ?? "").toLowerCase().includes(q),
          )
        : b.entries,
    }))
    .filter((b) => b.entries.length > 0);

  if (filtered.length === 0) {
    return <div className="text-[11px] text-text-muted px-1">No entrypoints match.</div>;
  }

  return (
    <>
      {filtered.map((b) => (
        <div key={b.domainId ?? "__unmapped__"}>
          <h3 className="text-[11px] font-semibold text-node-concept uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span aria-hidden>◆</span>
            {b.domainId ? (
              <button
                type="button"
                onClick={() => {
                  navigateToDomain(b.domainId!);
                  setViewMode("domain", { keepSelection: false });
                }}
                className="hover:text-accent transition-colors"
                title={`Open domain: ${b.domainName}`}
              >
                {b.domainName}
              </button>
            ) : (
              <span className="text-text-muted">{b.domainName}</span>
            )}
            <span className="text-text-muted font-mono normal-case">({b.entries.length})</span>
            {b.flowNames.size > 0 && (
              <span className="text-[9px] text-text-muted normal-case font-normal truncate">
                {[...b.flowNames].join(", ")}
              </span>
            )}
          </h3>
          <div className="space-y-1">
            {b.entries.map((e) => (
              <EntrypointRow key={e.node.id} entry={e} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Entrypoint index grouped by kind, with a free-text filter. */
function IndexView() {
  const graph = useDashboardStore((s) => s.graph);
  const [filter, setFilter] = useState("");
  const [byDomain, setByDomain] = useState(false);

  const groups = useMemo(() => entrypointIndex(graph), [graph]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        entries: g.entries.filter(
          (e) =>
            e.node.name.toLowerCase().includes(q) ||
            (e.path ?? "").toLowerCase().includes(q) ||
            (e.method ?? "").toLowerCase().includes(q) ||
            (e.handler?.name ?? "").toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.entries.length > 0);
  }, [groups, filter]);

  const total = groups.reduce((n, g) => n + g.entries.length, 0);

  if (total === 0) {
    return <div className="px-4 py-6 text-[11px] text-text-muted leading-relaxed">{EMPTY_HINT}</div>;
  }

  return (
    <div className="px-4 py-3 space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter entrypoints…"
          className="flex-1 min-w-0 bg-surface text-text-primary text-xs rounded-md px-2.5 py-2 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
        />
        <button
          type="button"
          onClick={() => setByDomain((v) => !v)}
          title="Group routes by their domain (item 28)"
          className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider px-2 py-1.5 rounded border transition-colors ${
            byDomain
              ? "border-node-concept/50 bg-node-concept/10 text-node-concept"
              : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
          }`}
        >
          ◆ Domain
        </button>
      </div>
      {byDomain ? (
        <DomainGroupedView filter={filter} />
      ) : filtered.length === 0 ? (
        <div className="text-[11px] text-text-muted px-1">No entrypoints match.</div>
      ) : (
        filtered.map((g) => (
          <div key={g.type}>
            <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span aria-hidden>{nodeTypeIcon(g.type)}</span>
              {g.label}
              <span className="text-text-muted font-mono normal-case">({g.entries.length})</span>
            </h3>
            <div className="space-y-1">
              {g.entries.map((e) => (
                <EntrypointRow key={e.node.id} entry={e} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

type SortKey = "method" | "path" | "handler";

/** API/Route map: sortable method · path · handler table. */
function ApiMapView() {
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const [sortKey, setSortKey] = useState<SortKey>("path");
  const [asc, setAsc] = useState(true);

  const rows = useMemo(() => {
    const list = routeMap(graph);
    const dir = asc ? 1 : -1;
    return [...list].sort((a, b) => {
      const av =
        sortKey === "method" ? (a.method ?? "") :
        sortKey === "handler" ? (a.handler?.name ?? "") :
        (a.path ?? a.node.name);
      const bv =
        sortKey === "method" ? (b.method ?? "") :
        sortKey === "handler" ? (b.handler?.name ?? "") :
        (b.path ?? b.node.name);
      return av.localeCompare(bv) * dir;
    });
  }, [graph, sortKey, asc]);

  if (rows.length === 0) {
    return <div className="px-4 py-6 text-[11px] text-text-muted leading-relaxed">{EMPTY_HINT}</div>;
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else { setSortKey(key); setAsc(true); }
  };
  const arrow = (key: SortKey) => (key === sortKey ? (asc ? " ▲" : " ▼") : "");

  return (
    <div className="px-3 py-3">
      <div className="text-[10px] text-text-muted px-1 mb-2">{rows.length} routes</div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-text-muted uppercase tracking-wider text-[9px]">
            <th className="text-left font-semibold py-1 cursor-pointer select-none w-16" onClick={() => toggleSort("method")}>
              Method{arrow("method")}
            </th>
            <th className="text-left font-semibold py-1 cursor-pointer select-none" onClick={() => toggleSort("path")}>
              Path{arrow("path")}
            </th>
            <th className="text-left font-semibold py-1 cursor-pointer select-none" onClick={() => toggleSort("handler")}>
              Handler{arrow("handler")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const target = r.handler ?? r.node;
            return (
              <tr
                key={r.node.id}
                className="border-t border-border-subtle hover:bg-elevated cursor-pointer transition-colors"
                onClick={() => focusEntity(target.id)}
                title={r.handler ? `Focus handler: ${r.handler.name}` : `Focus ${r.node.name}`}
              >
                <td className="py-1.5 pr-2 font-mono font-semibold text-node-endpoint align-top">
                  {r.method ?? "—"}
                </td>
                <td className="py-1.5 pr-2 font-mono text-text-primary break-all align-top">
                  {r.path ?? r.node.name}
                </td>
                <td className="py-1.5 text-text-secondary truncate align-top">
                  {r.handler?.name ?? <span className="text-text-muted italic">unresolved</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Reachability / dead-code overlay controls. */
function ReachView() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const reachabilityRootId = useDashboardStore((s) => s.reachabilityRootId);
  const deadCodeOverlay = useDashboardStore((s) => s.deadCodeOverlay);
  const setReachabilityRoot = useDashboardStore((s) => s.setReachabilityRoot);
  const toggleDeadCodeOverlay = useDashboardStore((s) => s.toggleDeadCodeOverlay);
  const clearReachabilityOverlay = useDashboardStore((s) => s.clearReachabilityOverlay);
  const nodesById = useDashboardStore((s) => s.nodesById);

  const entrypointCount = useMemo(
    () => (graph ? allEntrypointIds(graph).length : 0),
    [graph],
  );
  const rootName = reachabilityRootId ? nodesById.get(reachabilityRootId)?.name ?? reachabilityRootId : null;
  const selectedName = selectedNodeId ? nodesById.get(selectedNodeId)?.name : null;
  const active = !!reachabilityRootId || deadCodeOverlay;

  return (
    <div className="px-4 py-4 space-y-4">
      <p className="text-[11px] text-text-muted leading-relaxed">
        Reachability walks outgoing call / route / data edges from a root and dims
        everything it can't reach. Dead-code dims nodes reachable from no entrypoint.
      </p>

      {/* Reach from selection */}
      <button
        type="button"
        disabled={!selectedNodeId}
        onClick={() => selectedNodeId && setReachabilityRoot(selectedNodeId)}
        className="w-full text-left px-3 py-2 rounded-lg border border-border-subtle bg-elevated text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <div className="font-semibold text-text-primary mb-0.5">Reach from selection</div>
        <div className="text-text-muted truncate">
          {selectedName ? `From: ${selectedName}` : "Select a node first"}
        </div>
      </button>

      {/* Dead-code toggle */}
      <button
        type="button"
        disabled={entrypointCount === 0}
        onClick={toggleDeadCodeOverlay}
        className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          deadCodeOverlay
            ? "border-[#c97070]/50 bg-[#c97070]/10 text-[#c97070]"
            : "border-border-subtle bg-elevated text-text-secondary hover:border-accent/40 hover:text-text-primary"
        }`}
      >
        <div className="font-semibold mb-0.5">
          {deadCodeOverlay ? "Dead-code overlay ON" : "Dead-code overlay"}
        </div>
        <div className="text-text-muted">
          {entrypointCount === 0
            ? "No entrypoints — cannot compute dead code"
            : `Dim nodes reachable from none of ${entrypointCount} entrypoints`}
        </div>
      </button>

      {/* Active overlay status + clear */}
      {active && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30">
          <span className="text-[11px] text-accent truncate">
            {deadCodeOverlay ? "Showing dead code" : `Reachable from ${rootName}`}
          </span>
          <button
            type="button"
            onClick={clearReachabilityOverlay}
            className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-muted hover:text-text-primary"
          >
            clear
          </button>
        </div>
      )}

      {entrypointCount === 0 && (
        <div className="text-[11px] text-text-muted leading-relaxed">{EMPTY_HINT}</div>
      )}
    </div>
  );
}

export default function FrontDoorPanel() {
  const [view, setView] = useState<DoorView>(readDoorView);
  const setViewPersisted = (v: DoorView) => {
    setView(v);
    try { window.localStorage.setItem(DOOR_VIEW_KEY, v); } catch { /* ignore */ }
  };

  const tabs: { id: DoorView; label: string }[] = [
    { id: "index", label: "Index" },
    { id: "api", label: "API map" },
    { id: "reach", label: "Reach" },
  ];

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 shrink-0">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setViewPersisted(tb.id)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              view === tb.id
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text-primary hover:bg-elevated"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {view === "index" ? <IndexView /> : view === "api" ? <ApiMapView /> : <ReachView />}
      </div>
    </div>
  );
}

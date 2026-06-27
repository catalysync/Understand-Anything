// Wave-2 feature 20 + Integration item 184: the ⌘K palette is now a full
// COMMAND palette — symbol/federated jump + view switches + actions ("Trace from
// X", "Explain", "Copy link", "Open settings"). Category-grouped. When the query
// is empty it surfaces recent + pinned destinations (item 187). Federated search
// (item 185) spans structural + domain flows/steps + symbols with type badges,
// and each result routes to its best view (item 186).
import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import { federatedSearch, routeForResult } from "../utils/federatedSearch";
import type { FederatedResult, RouteKind } from "../utils/federatedSearch";

function typeBadgeColor(type: string): string {
  if (type === "function") return "var(--color-node-function)";
  if (type === "class") return "var(--color-node-class)";
  if (type === "file") return "var(--color-node-file)";
  if (type === "flow") return "var(--color-node-pipeline)";
  if (type === "step") return "var(--color-node-function)";
  if (type === "domain") return "var(--color-node-concept)";
  return "var(--color-node-concept)";
}

const ROUTE_HINT: Record<RouteKind, string> = {
  trace: "trace",
  domain: "domain",
  structural: "graph",
  code: "code",
};

/** A flat palette row — either a navigable entity or an app command. */
type Row =
  | {
      kind: "entity";
      id: string;
      name: string;
      type: string;
      category: string;
      badge: string;
      hint: string;
      run: () => void;
    }
  | {
      kind: "command";
      id: string;
      name: string;
      type: string;
      category: string;
      badge: string;
      hint: string;
      run: () => void;
    };

export default function SymbolPalette() {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const open = useDashboardStore((s) => s.symbolPaletteOpen);
  const setOpen = useDashboardStore((s) => s.setSymbolPaletteOpen);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const openSearchResult = useDashboardStore((s) => s.openSearchResult);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const destinations = useDashboardStore((s) => s.destinations);
  const setSettingsModalOpen = useDashboardStore((s) => s.setSettingsModalOpen);
  const togglePinnedDestination = useDashboardStore((s) => s.togglePinnedDestination);
  const searchResults = useDashboardStore((s) => s.searchResults);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  // ---- Commands (always available; filtered by query substring) -----------
  const commands = useMemo<Row[]>(() => {
    const cmds: Row[] = [
      {
        kind: "command",
        id: "cmd-view-structural",
        name: "Go to Structural graph",
        type: "command",
        category: "Commands",
        badge: "VIEW",
        hint: "g",
        run: () => {
          setViewMode("structural");
          close();
        },
      },
      {
        kind: "command",
        id: "cmd-view-trace",
        name: "Go to Trace view",
        type: "command",
        category: "Commands",
        badge: "VIEW",
        hint: "t",
        run: () => {
          setViewMode("trace");
          close();
        },
      },
      {
        kind: "command",
        id: "cmd-open-settings",
        name: "Open settings",
        type: "command",
        category: "Commands",
        badge: "ACTION",
        hint: "",
        run: () => {
          setSettingsModalOpen(true);
          close();
        },
      },
    ];
    if (domainGraph) {
      cmds.splice(1, 0, {
        kind: "command",
        id: "cmd-view-domain",
        name: "Go to Domain flows",
        type: "command",
        category: "Commands",
        badge: "VIEW",
        hint: "",
        run: () => {
          setViewMode("domain");
          close();
        },
      });
    }
    // Selection-scoped actions.
    if (selectedNodeId) {
      const selName =
        graph?.nodes.find((n) => n.id === selectedNodeId)?.name ?? "selection";
      cmds.push(
        {
          kind: "command",
          id: "cmd-trace-selected",
          name: `Trace from ${selName}`,
          type: "command",
          category: "Commands",
          badge: "ACTION",
          hint: "",
          run: () => {
            startTraceAt(selectedNodeId);
            close();
          },
        },
        {
          kind: "command",
          id: "cmd-explain-selected",
          name: `Explain ${selName}`,
          type: "command",
          category: "Commands",
          badge: "ACTION",
          hint: "",
          run: () => {
            focusEntity(selectedNodeId, { view: "structural" });
            openCodeViewer(selectedNodeId);
            close();
          },
        },
        {
          kind: "command",
          id: "cmd-copy-link",
          name: `Copy link to ${selName}`,
          type: "command",
          category: "Commands",
          badge: "ACTION",
          hint: "",
          run: () => {
            const url = `${window.location.origin}${window.location.pathname}#node=${encodeURIComponent(
              selectedNodeId,
            )}`;
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(url).catch(() => {});
            }
            close();
          },
        },
      );
    }
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainGraph, selectedNodeId, graph]);

  // ---- Federated entity results -------------------------------------------
  const entityRows = useMemo<Row[]>(() => {
    const structuralHits = searchResults.map((r) => ({
      nodeId: r.nodeId,
      score: r.score,
    }));
    const results: FederatedResult[] = federatedSearch(
      query,
      graph,
      domainGraph,
      structuralHits.length > 0 ? structuralHits : undefined,
      40,
    );
    return results.map((r) => {
      const route = routeForResult(r);
      const category =
        r.realm === "domain"
          ? "Domain"
          : r.realm === "step"
            ? "Domain steps"
            : r.realm === "symbol"
              ? "Symbols"
              : "Structural";
      return {
        kind: "entity" as const,
        id: r.nodeId,
        name: r.name,
        type: r.nodeType,
        category,
        badge: r.badge,
        hint: ROUTE_HINT[route.primary],
        run: () => {
          openSearchResult(r.nodeId, route.primary, r.domainId);
          close();
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, graph, domainGraph, searchResults]);

  // ---- Empty-state: recent + pinned ---------------------------------------
  const emptyRows = useMemo<Row[]>(() => {
    if (query.trim()) return [];
    const rows: Row[] = [];
    for (const p of destinations.pinned) {
      rows.push({
        kind: "entity",
        id: `pin-${p.nodeId}`,
        name: p.name,
        type: p.type,
        category: "Pinned",
        badge: p.type.toUpperCase(),
        hint: "★",
        run: () => {
          focusEntity(p.nodeId, { view: "structural" });
          close();
        },
      });
    }
    for (const r of destinations.recent) {
      rows.push({
        kind: "entity",
        id: `recent-${r.nodeId}`,
        name: r.name,
        type: r.type,
        category: "Recent",
        badge: r.type.toUpperCase(),
        hint: "",
        run: () => {
          focusEntity(r.nodeId, { view: "structural" });
          close();
        },
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, destinations]);

  // Filter commands by query; combine.
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const cmdRows = q
      ? commands.filter((c) => c.name.toLowerCase().includes(q))
      : commands;
    if (!q) {
      // Empty: recent + pinned first, then commands.
      return [...emptyRows, ...cmdRows];
    }
    return [...cmdRows, ...entityRows];
  }, [query, commands, entityRows, emptyRows]);

  // Group rows by category, preserving first-seen order.
  const grouped = useMemo(() => {
    const groups: { category: string; rows: { row: Row; idx: number }[] }[] = [];
    rows.forEach((row, idx) => {
      let g = groups.find((x) => x.category === row.category);
      if (!g) {
        g = { category: row.category, rows: [] };
        groups.push(g);
      }
      g.rows.push({ row, idx });
    });
    return groups;
  }, [rows]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      rows[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl mx-4 rounded-xl border border-border-medium bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border-subtle">
          <span className="text-accent text-sm font-mono shrink-0">⌘K</span>
          <input
            ref={inputRef}
            type="text"
            data-testid="symbol-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search symbols, flows, steps — or run a command…"
            className="flex-1 bg-transparent text-text-primary text-sm focus:outline-none placeholder-text-muted"
          />
          <span className="text-[10px] text-text-muted shrink-0">{rows.length}</span>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-auto py-1">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              No matches.
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category}>
                <div className="px-3.5 pt-2 pb-1 text-[9px] uppercase tracking-wider text-text-muted/70">
                  {group.category}
                </div>
                {group.rows.map(({ row, idx }) => {
                  const isActive = idx === active;
                  const isEntity = row.kind === "entity";
                  return (
                    <button
                      key={row.id}
                      type="button"
                      data-idx={idx}
                      data-testid="symbol-palette-item"
                      onMouseEnter={() => setActive(idx)}
                      onClick={row.run}
                      className={`w-full text-left flex items-center gap-2.5 px-3.5 py-1.5 transition-colors ${
                        isActive ? "bg-accent/15" : "hover:bg-elevated/50"
                      }`}
                    >
                      <span
                        className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 w-16 text-center"
                        style={{
                          color: typeBadgeColor(row.type),
                          backgroundColor: `color-mix(in srgb, ${typeBadgeColor(
                            row.type,
                          )} 12%, transparent)`,
                        }}
                      >
                        {row.badge}
                      </span>
                      <span className="text-[13px] font-mono text-text-primary truncate">
                        {row.name}
                      </span>
                      {row.hint && (
                        <span className="text-[10px] font-mono text-text-muted ml-auto pl-2 shrink-0">
                          {row.hint}
                        </span>
                      )}
                      {isEntity && !row.id.startsWith("pin-") && !row.id.startsWith("recent-") && (
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinnedDestination(row.id);
                          }}
                          className="text-[11px] text-text-muted hover:text-accent shrink-0 pl-1"
                          title="Pin / unpin"
                        >
                          ☆
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="px-3.5 py-2 border-t border-border-subtle flex items-center gap-3 text-[10px] text-text-muted">
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">☆</kbd> pin</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

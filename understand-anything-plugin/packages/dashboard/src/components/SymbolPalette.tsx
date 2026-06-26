// Wave-2 feature 20: fuzzy symbol command palette (⌘K / ⌘P).
// Keyboard-driven modal: fuzzy-search every graph node by name, Enter starts a
// trace there (or ⇧Enter opens it in the structural graph / CodeViewer).
import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import { fuzzySearchNodes, packageLabel, packageOf } from "./traceGraph";

function typeBadgeColor(type: string): string {
  if (type === "function") return "var(--color-node-function)";
  if (type === "class") return "var(--color-node-class)";
  if (type === "file") return "var(--color-node-file)";
  return "var(--color-node-concept)";
}

export default function SymbolPalette() {
  const graph = useDashboardStore((s) => s.graph);
  const open = useDashboardStore((s) => s.symbolPaletteOpen);
  const setOpen = useDashboardStore((s) => s.setSymbolPaletteOpen);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!graph) return [];
    return fuzzySearchNodes(graph.nodes, query, 40);
  }, [graph, query]);

  // Reset + focus when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus on next tick so the input is mounted.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open || !graph) return null;

  const choose = (idx: number, openInGraph: boolean) => {
    const node = results[idx];
    if (!node) return;
    if (openInGraph) {
      selectNode(node.id);
      setViewMode("structural");
      setOpen(false);
    } else {
      startTraceAt(node.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active, e.shiftKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Symbol palette"
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
            placeholder="Search any symbol (function / class / file)…"
            className="flex-1 bg-transparent text-text-primary text-sm focus:outline-none placeholder-text-muted"
          />
          <span className="text-[10px] text-text-muted shrink-0">{results.length}</span>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-xs">No matching symbols.</div>
          ) : (
            results.map((n, i) => {
              const isActive = i === active;
              return (
                <button
                  key={n.id}
                  type="button"
                  data-idx={i}
                  data-testid="symbol-palette-item"
                  onMouseEnter={() => setActive(i)}
                  onClick={(e) => choose(i, e.shiftKey)}
                  className={`w-full text-left flex items-center gap-2.5 px-3.5 py-1.5 transition-colors ${
                    isActive ? "bg-accent/15" : "hover:bg-elevated/50"
                  }`}
                >
                  <span
                    className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 w-14 text-center"
                    style={{
                      color: typeBadgeColor(n.type),
                      backgroundColor: `color-mix(in srgb, ${typeBadgeColor(n.type)} 12%, transparent)`,
                    }}
                  >
                    {n.type}
                  </span>
                  <span className="text-[13px] font-mono text-text-primary truncate">{n.name}</span>
                  <span className="text-[10px] font-mono text-text-muted truncate ml-auto pl-2">
                    {packageLabel(packageOf(n))}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="px-3.5 py-2 border-t border-border-subtle flex items-center gap-3 text-[10px] text-text-muted">
          <span><kbd className="font-mono">↵</kbd> trace</span>
          <span><kbd className="font-mono">⇧↵</kbd> open in graph</span>
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// 200-156: Reading-order mode — "read the repo like a book". Lists files in
// BFS-from-entrypoint order (entrypoint/endpoint nodes, else highest fan-in as
// roots; walks imports/calls). Shows one file at a time with prev/next; each →
// focus. A progress bar + jump list let the reader scan the whole table of
// contents. Reuses the floating-panel shell.
import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { buildReadingOrder } from "../utils/vizLayout";

export default function ReadingOrderPanel() {
  const open = useDashboardStore((s) => s.readingPanelOpen);
  const setOpen = useDashboardStore((s) => s.setReadingPanelOpen);
  const graph = useDashboardStore((s) => s.graph);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const focusEntity = useDashboardStore((s) => s.focusEntity);

  const order = useMemo(() => (graph ? buildReadingOrder(graph) : []), [graph]);
  const [idx, setIdx] = useState(0);
  const [showToc, setShowToc] = useState(false);

  // Clamp when order changes.
  useEffect(() => {
    if (idx >= order.length) setIdx(0);
  }, [order.length, idx]);

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(order.length - 1, i));
    setIdx(clamped);
    const id = order[clamped];
    if (id) focusEntity(id, { view: "structural" });
  };

  if (!open) return null;

  const currentId = order[idx];
  const node = currentId ? nodesById.get(currentId) : null;

  return (
    <div className="absolute bottom-4 left-4 z-20 rounded-xl border border-border-medium bg-surface/95 shadow-2xl backdrop-blur-sm w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
        <div>
          <div className="text-xs font-semibold text-text-primary">Reading order</div>
          <div className="text-[10px] text-text-muted">Read the repo like a book (BFS from entrypoints)</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          aria-label="Close reading-order panel"
        >
          ×
        </button>
      </div>

      {order.length === 0 ? (
        <div className="px-5 py-10 text-center text-[11px] text-text-muted leading-relaxed">
          No file nodes to walk. Re-run <span className="font-mono">/understand</span>.
        </div>
      ) : (
        <div className="p-3">
          {/* Progress */}
          <div className="flex items-center justify-between text-[10px] text-text-muted mb-1.5">
            <span>{idx + 1} / {order.length}</span>
            <button
              type="button"
              onClick={() => setShowToc((v) => !v)}
              className="hover:text-text-primary underline decoration-dotted"
            >
              {showToc ? "Hide contents" : "Table of contents"}
            </button>
          </div>
          <div className="h-1 rounded bg-elevated overflow-hidden mb-2">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${((idx + 1) / order.length) * 100}%` }}
            />
          </div>

          {showToc ? (
            <div className="max-h-[220px] overflow-auto rounded border border-border-subtle">
              {order.map((id, i) => {
                const n = nodesById.get(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => goTo(i)}
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] border-b border-border-subtle/50 last:border-0 truncate ${
                      i === idx ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-elevated"
                    }`}
                  >
                    <span className="text-text-muted mr-1.5">{i + 1}.</span>
                    {n?.name ?? id}
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              className="rounded border border-border-subtle p-3 cursor-pointer hover:border-border-medium"
              onClick={() => currentId && focusEntity(currentId, { view: "structural" })}
            >
              <div className="text-[13px] font-semibold text-text-primary truncate">
                {node?.name ?? currentId}
              </div>
              {node?.filePath && (
                <div className="text-[10px] text-text-muted font-mono truncate mt-0.5">{node.filePath}</div>
              )}
              {node?.summary && (
                <div className="text-[11px] text-text-secondary mt-1.5 line-clamp-3">{node.summary}</div>
              )}
              <div className="text-[10px] text-accent mt-2">Click to focus this file in the graph →</div>
            </div>
          )}

          {/* Nav */}
          <div className="flex items-center justify-between gap-2 mt-2">
            <button
              type="button"
              disabled={idx === 0}
              onClick={() => goTo(idx - 1)}
              className="flex-1 text-[11px] px-2 py-1.5 rounded border border-border-medium bg-elevated text-text-secondary hover:text-text-primary disabled:opacity-30"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={idx >= order.length - 1}
              onClick={() => goTo(idx + 1)}
              className="flex-1 text-[11px] px-2 py-1.5 rounded border border-border-medium bg-elevated text-text-secondary hover:text-text-primary disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useDashboardStore } from "../store";

/**
 * Bookmarks / Investigation side panel. Lists persisted bookmarks,
 * annotations and saved tours. Each row jumps to its node (re-roots the
 * trace) or restores a saved tour. All persisted file-side in workspace.json.
 */
export default function BookmarksPanel() {
  const open = useDashboardStore((s) => s.bookmarksPanelOpen);
  const toggle = useDashboardStore((s) => s.toggleBookmarksPanel);
  const workspace = useDashboardStore((s) => s.workspace);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const setTraceRoot = useDashboardStore((s) => s.setTraceRoot);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const toggleBookmark = useDashboardStore((s) => s.toggleBookmark);
  const removeAnnotation = useDashboardStore((s) => s.removeAnnotation);
  const removeTour = useDashboardStore((s) => s.removeTour);

  if (!open) return null;

  const jumpTo = (nodeId: string) => {
    // setViewMode only resets selection (not the trace root/stack), so set the
    // trace root after switching view to re-root the trace on the target node.
    setViewMode("trace");
    setTraceRoot(nodeId);
    toggle();
  };

  const nodeName = (id: string) => nodesById.get(id)?.name ?? id;

  const { bookmarks, annotations, tours } = workspace;
  const empty = bookmarks.length === 0 && annotations.length === 0 && tours.length === 0;

  return (
    <div className="absolute top-0 right-0 h-full w-80 max-w-[85vw] z-30 bg-elevated border-l border-border-subtle shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <span className="text-sm font-heading text-text-primary">★ Bookmarks / Investigation</span>
        <button
          type="button"
          onClick={toggle}
          className="text-text-muted hover:text-text-primary"
          title="Close"
          data-testid="close-investigation"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {empty && (
          <p className="text-xs text-text-muted leading-relaxed px-1">
            No saved context yet. Bookmark a hop (★), pin a note (✎), or save a trace as a tour.
            Everything here persists to <span className="font-mono">workspace.json</span> and
            survives restarts.
          </p>
        )}

        {bookmarks.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
              Bookmarks ({bookmarks.length})
            </div>
            <div className="space-y-1">
              {bookmarks.map((b) => (
                <div key={b.id} className="flex items-center gap-2 group" data-testid="bookmark-row">
                  <button
                    type="button"
                    onClick={() => jumpTo(b.nodeId)}
                    className="flex-1 min-w-0 text-left text-[12px] text-text-secondary hover:text-accent truncate px-2 py-1 rounded hover:bg-surface"
                    title={b.label ?? b.nodeId}
                  >
                    ★ {b.label ?? nodeName(b.nodeId)}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleBookmark(b.nodeId)}
                    className="text-text-muted hover:text-node-concept text-xs opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {annotations.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
              Notes ({annotations.length})
            </div>
            <div className="space-y-1.5">
              {annotations.map((a) => (
                <div key={a.id} className="rounded-md border border-border-subtle bg-surface/50 px-2.5 py-1.5" data-testid="annotation-row">
                  <div className="flex items-center justify-between mb-0.5">
                    <button
                      type="button"
                      onClick={() => jumpTo(a.nodeId)}
                      className="text-[11px] font-mono text-text-muted hover:text-accent truncate"
                      title={a.nodeId}
                    >
                      {nodeName(a.nodeId)}
                      {a.lineRange ? `:${a.lineRange[0]}–${a.lineRange[1]}` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAnnotation(a.id)}
                      className="text-text-muted hover:text-node-concept text-xs"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                    📌 {a.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tours.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1.5">
              Saved tours ({tours.length})
            </div>
            <div className="space-y-1">
              {tours.map((tr) => (
                <div key={tr.id} className="flex items-center gap-2 group">
                  <button
                    type="button"
                    onClick={() => tr.hopIds[0] && jumpTo(tr.hopIds[0])}
                    className="flex-1 min-w-0 text-left text-[12px] text-text-secondary hover:text-accent truncate px-2 py-1 rounded hover:bg-surface"
                    title={`${tr.hopIds.length} hops`}
                  >
                    ▸ {tr.name} <span className="text-text-muted">({tr.hopIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTour(tr.id)}
                    className="text-text-muted hover:text-node-concept text-xs opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

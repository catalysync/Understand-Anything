import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { featureFlagMap } from "../utils/opsLayer";

/**
 * 300-series item 88: Feature-flag → code map + dead-flag detection.
 * Lists every `feature_flag` node with its gated code (reverse `gated_by_flag`),
 * the reference count, and a "ready for removal" badge when ref-count is 0 or 1.
 * Clicking a consumer focuses it. Empty-states cleanly when there are no flags
 * yet (the feature_flag enrichment runs in parallel).
 */
export default function FeatureFlagPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const [filter, setFilter] = useState("");

  const entries = useMemo(() => featureFlagMap(graph), [graph]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.node.name.toLowerCase().includes(q) ||
        e.consumers.some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [entries, filter]);

  if (entries.length === 0) {
    return (
      <div className="px-5 py-6 text-center">
        <div className="text-2xl mb-2">⚑</div>
        <p className="text-sm text-text-primary font-medium mb-1">No feature flags yet</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Once the graph is enriched with <span className="font-mono">feature_flag</span> nodes and{" "}
          <span className="font-mono">gated_by_flag</span> edges, every flag and the code it gates
          will appear here — with a removal badge for dead flags.
        </p>
      </div>
    );
  }

  const removable = entries.filter((e) => e.readyForRemoval).length;

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-node-config-ops uppercase tracking-wider">
          Feature flags ({entries.length})
        </h3>
        {removable > 0 && (
          <span
            className="text-[10px] text-[#c97070]"
            title="Flags gating 0 or 1 site — candidates for removal"
          >
            {removable} removable
          </span>
        )}
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter flags…"
        className="w-full bg-surface text-text-primary text-xs rounded-md px-2.5 py-2 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
      />

      {filtered.length === 0 ? (
        <div className="text-[11px] text-text-muted px-1">No flags match.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <div
              key={e.node.id}
              className="rounded-lg border border-border-subtle bg-elevated overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle/60">
                <span className="text-node-config-ops shrink-0" aria-hidden>⚑</span>
                <button
                  type="button"
                  onClick={() => navigateToNode(e.node.id)}
                  className="font-mono text-xs text-text-primary truncate flex-1 text-left hover:text-accent transition-colors"
                  title={e.node.summary || e.node.name}
                >
                  {e.node.name}
                </button>
                <span
                  className="text-[10px] font-mono text-text-muted shrink-0"
                  title={`${e.refCount} gated site${e.refCount === 1 ? "" : "s"}`}
                >
                  {e.refCount} ref{e.refCount === 1 ? "" : "s"}
                </span>
                {e.readyForRemoval && (
                  <span
                    className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 text-[#c97070] bg-[#c97070]/15 border border-[#c97070]/30"
                    title={
                      e.refCount === 0
                        ? "No code references this flag — safe to remove"
                        : "Only one site gated — consider inlining and removing"
                    }
                  >
                    Ready for removal
                  </span>
                )}
              </div>
              {e.consumers.length > 0 ? (
                <div className="px-2 py-1.5 space-y-1">
                  {e.consumers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => focusEntity(c.id, { view: "structural" })}
                      className="w-full flex items-center gap-1.5 text-[11px] px-2 py-1 rounded hover:bg-surface transition-colors text-left"
                      title={`Focus consumer ${c.name}`}
                    >
                      <span className="text-text-muted shrink-0" aria-hidden>↳</span>
                      <span className="text-text-secondary truncate flex-1">{c.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-1.5 text-[10px] text-text-muted italic">
                  No gated code found — dead flag
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

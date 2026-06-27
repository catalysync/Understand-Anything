import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { configMap } from "../utils/opsLayer";

/**
 * 300-series item 86: Config / env map. Lists `env_var` (and feature_flag /
 * secret) nodes with a required/optional badge (red = required, no default)
 * and their consumers (reverse `reads_config`). Clicking a consumer focuses it.
 * Empty-states cleanly when the graph has no env_var nodes yet.
 */
export default function ConfigMapPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);

  const entries = useMemo(() => configMap(graph), [graph]);

  if (entries.length === 0) {
    return (
      <div className="px-5 py-6 text-center">
        <div className="text-2xl mb-2">⚙</div>
        <p className="text-sm text-text-primary font-medium mb-1">No config map yet</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Once the graph is enriched with <span className="font-mono">env_var</span> nodes and{" "}
          <span className="font-mono">reads_config</span> edges, every environment variable and
          its consumers will be listed here.
        </p>
      </div>
    );
  }

  const requiredCount = entries.filter((e) => e.required).length;

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-node-config-ops uppercase tracking-wider">
          Config / Env ({entries.length})
        </h3>
        {requiredCount > 0 && (
          <span className="text-[10px] text-[#c97070]">{requiredCount} required</span>
        )}
      </div>

      <div className="space-y-2">
        {entries.map((e) => (
          <div
            key={e.node.id}
            className="rounded-lg border border-border-subtle bg-elevated overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle/60">
              <span className="text-node-config-ops shrink-0" aria-hidden>
                {e.node.type === "secret" ? "🔒" : e.node.type === "feature_flag" ? "⚑" : "⚙"}
              </span>
              <button
                type="button"
                onClick={() => navigateToNode(e.node.id)}
                className="font-mono text-xs text-text-primary truncate flex-1 text-left hover:text-accent transition-colors"
                title={e.node.name}
              >
                {e.node.name}
              </button>
              <span
                className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                  e.required
                    ? "text-[#c97070] bg-[#c97070]/15 border border-[#c97070]/30"
                    : "text-text-muted bg-border-subtle/40"
                }`}
                title={e.required ? "Required — no default" : "Optional"}
              >
                {e.required ? "Required" : "Optional"}
              </span>
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
                No consumers found {e.required ? "— required but unread?" : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

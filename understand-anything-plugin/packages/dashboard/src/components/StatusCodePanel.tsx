import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { statusCodeMap, nodeTypeIcon, type StatusClass } from "../utils/opsLayer";

/**
 * 300-series item 98: HTTP status-code → handler map. Detects status-emitting
 * nodes (routes/endpoints/error_types/code tagged or whose summary/source
 * mentions status codes) and groups them by status class (2xx/3xx/4xx/5xx).
 * A class filter ("show me everywhere that can return a 5xx") narrows the list.
 * Heuristic + graceful when sparse — empty-states when nothing is detected.
 */

const CLASS_LABEL: Record<StatusClass, string> = {
  "2xx": "Success",
  "3xx": "Redirect",
  "4xx": "Client error",
  "5xx": "Server error",
};

/** Color token per class (reuses the ops palette). */
function classColor(cls: StatusClass): string {
  if (cls === "2xx") return "var(--color-node-test)";
  if (cls === "3xx") return "var(--color-node-endpoint)";
  if (cls === "4xx") return "var(--color-node-finding)";
  return "var(--color-node-error)";
}

export default function StatusCodePanel() {
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const [active, setActive] = useState<StatusClass | null>(null);

  const groups = useMemo(() => statusCodeMap(graph), [graph]);
  const visible = active ? groups.filter((g) => g.cls === active) : groups;

  if (groups.length === 0) {
    return (
      <div className="px-5 py-6 text-center">
        <div className="text-2xl mb-2">⚠</div>
        <p className="text-sm text-text-primary font-medium mb-1">No status codes detected</p>
        <p className="text-xs text-text-muted leading-relaxed">
          No nodes appear to emit HTTP status codes yet. As the graph gains
          routes, error types, and status-bearing handlers, every emitter will be
          grouped here by status class (2xx / 4xx / 5xx).
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">
        Status → handlers
      </h3>

      {/* Class filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setActive(null)}
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
            active === null
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
          }`}
        >
          All
        </button>
        {groups.map((g) => (
          <button
            key={g.cls}
            type="button"
            onClick={() => setActive(active === g.cls ? null : g.cls)}
            className={`text-[10px] font-mono font-semibold px-2 py-1 rounded border transition-colors ${
              active === g.cls ? "bg-elevated" : "bg-elevated/50 hover:bg-elevated"
            }`}
            style={{
              color: classColor(g.cls),
              borderColor: active === g.cls ? classColor(g.cls) : "var(--color-border-medium)",
            }}
            title={`Show everywhere that can return a ${g.cls} (${CLASS_LABEL[g.cls]})`}
          >
            {g.cls} <span className="opacity-70">({g.count})</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.map((g) => (
          <div key={g.cls}>
            <div
              className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5"
              style={{ color: classColor(g.cls) }}
            >
              <span className="font-mono">{g.cls}</span>
              <span className="text-text-muted normal-case font-normal">
                {CLASS_LABEL[g.cls]} · {g.count}
              </span>
            </div>
            <div className="space-y-1">
              {g.emitters.map((em) => (
                <button
                  key={em.node.id}
                  type="button"
                  onClick={() => focusEntity(em.node.id)}
                  className="w-full text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle flex items-center gap-2 text-left hover:border-accent/40 transition-colors group"
                  title={em.node.summary || em.node.name}
                >
                  <span className="shrink-0" aria-hidden>{nodeTypeIcon(em.node.type)}</span>
                  <span className="flex-1 min-w-0 text-text-primary truncate group-hover:text-accent transition-colors">
                    {em.node.name}
                  </span>
                  <span className="shrink-0 flex gap-1">
                    {em.codes.slice(0, 4).map((c) => (
                      <span
                        key={c}
                        className="font-mono text-[9px] font-semibold px-1 py-0.5 rounded"
                        style={{ color: classColor(g.cls), background: "var(--color-surface)" }}
                      >
                        {c}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

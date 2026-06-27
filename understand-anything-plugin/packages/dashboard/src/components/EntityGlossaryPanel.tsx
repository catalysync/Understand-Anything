import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { entityGlossary } from "../utils/domainHelpers";

/**
 * Item 118: entity glossary. Aggregates every `domainMeta.entities` across all
 * domains into one panel listing which domains own/share each entity. Clicking
 * a domain navigates into it; clicking the entity name highlights every
 * flow/step touching it (reuses the item-114 entity filter) inside that domain.
 */
export default function EntityGlossaryPanel() {
  const open = useDashboardStore((s) => s.entityGlossaryOpen);
  const toggle = useDashboardStore((s) => s.toggleEntityGlossary);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const setEntityFilter = useDashboardStore((s) => s.setDomainEntityFilter);
  const [query, setQuery] = useState("");

  const glossary = useMemo(
    () => (domainGraph ? entityGlossary(domainGraph) : []),
    [domainGraph],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return glossary;
    return glossary.filter(
      (g) =>
        g.entity.toLowerCase().includes(q) ||
        g.domains.some((d) => d.name.toLowerCase().includes(q)),
    );
  }, [glossary, query]);

  if (!open || !domainGraph) return null;

  const jump = (entity: string, domainId: string) => {
    navigateToDomain(domainId);
    setEntityFilter(entity);
    toggle();
  };

  return (
    <div className="absolute top-3 right-3 z-30 w-[320px] max-h-[70vh] flex flex-col rounded-xl bg-surface border border-border-medium shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="text-xs font-semibold text-node-entity uppercase tracking-wider">
          Entity glossary
        </div>
        <button
          type="button"
          onClick={() => toggle()}
          className="text-text-muted hover:text-text-primary text-sm"
          title="Close glossary"
        >
          ✕
        </button>
      </div>
      <div className="px-3 py-2 border-b border-border-subtle">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter entities / domains…"
          className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none"
        />
      </div>
      <div className="overflow-auto px-2 py-2 space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-[11px] text-text-muted px-2 py-3 text-center">
            No entities match.
          </div>
        )}
        {filtered.map((g) => {
          const shared = g.domains.length > 1;
          return (
            <div
              key={g.entity}
              className="rounded-lg bg-elevated border border-border-subtle px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[12px] font-medium text-text-primary truncate">
                  {g.entity}
                </span>
                {shared ? (
                  <span
                    title="Shared across domains"
                    className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-gold/15 text-gold shrink-0"
                  >
                    shared ×{g.domains.length}
                  </span>
                ) : (
                  <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-node-entity/15 text-node-entity shrink-0">
                    owned
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {g.domains.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => jump(g.entity, d.id)}
                    title={`Focus ${d.name} on ${g.entity}`}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-text-secondary hover:border-accent/50 hover:text-accent transition-colors truncate max-w-[140px]"
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

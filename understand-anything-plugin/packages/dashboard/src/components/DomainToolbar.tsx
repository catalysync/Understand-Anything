import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import {
  searchDomainGraph,
  computeDomainCoverage,
  longestCrossDomainChain,
  presentEntryTypes,
  ENTRY_TYPE_COLOR,
  flowCountByDomain,
  allDomainEntities,
} from "../utils/domainHelpers";

/**
 * Top-right domain toolbar bundling:
 *  - feature 113: domain search (domains/flows/steps/entities) → jump in,
 *  - feature 99: storyline toggle (linearize the longest cross_domain chain),
 *  - feature 123: domain coverage meter (% structural files mapped + unmapped).
 */
export default function DomainToolbar() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const graph = useDashboardStore((s) => s.graph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const storyline = useDashboardStore((s) => s.domainStorylineMode);
  const toggleStoryline = useDashboardStore((s) => s.toggleDomainStoryline);
  const query = useDashboardStore((s) => s.domainSearchQuery);
  const setQuery = useDashboardStore((s) => s.setDomainSearchQuery);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const setFocusedFlow = useDashboardStore((s) => s.setFocusedFlow);
  // 200-series domain polish.
  const entryTypeFilter = useDashboardStore((s) => s.domainEntryTypeFilter); // 117
  const setEntryTypeFilter = useDashboardStore((s) => s.setDomainEntryTypeFilter);
  const minFlows = useDashboardStore((s) => s.domainMinFlows); // 119
  const setMinFlows = useDashboardStore((s) => s.setDomainMinFlows);
  const entityFilter = useDashboardStore((s) => s.domainEntityFilter); // 114
  const setEntityFilter = useDashboardStore((s) => s.setDomainEntityFilter);
  const glossaryOpen = useDashboardStore((s) => s.entityGlossaryOpen); // 118
  const toggleGlossary = useDashboardStore((s) => s.toggleEntityGlossary);

  const [coverageOpen, setCoverageOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Item 117: entry-types present across flows (for the legend + filter).
  const entryTypes = useMemo(
    () => (domainGraph ? presentEntryTypes(domainGraph) : []),
    [domainGraph],
  );

  // Item 119: max flow count across domains (to bound the slider).
  const maxFlows = useMemo(() => {
    if (!domainGraph) return 0;
    let m = 0;
    for (const v of flowCountByDomain(domainGraph).values())
      if (v > m) m = v;
    return m;
  }, [domainGraph]);

  // Item 114: entities of the active domain become filter chips.
  const activeDomainEntities = useMemo(() => {
    if (!domainGraph || !activeDomainId) return [];
    const node = domainGraph.nodes.find((n) => n.id === activeDomainId);
    return ((node?.domainMeta?.entities ?? []) as string[]).slice();
  }, [domainGraph, activeDomainId]);

  // All entities (used to enable the glossary button only when meaningful).
  const hasEntities = useMemo(
    () => (domainGraph ? allDomainEntities(domainGraph).length > 0 : false),
    [domainGraph],
  );

  const hits = useMemo(() => {
    if (!domainGraph || !query.trim()) return [];
    return searchDomainGraph(domainGraph, query);
  }, [domainGraph, query]);

  const structuralFilePaths = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => n.type === "file" && n.filePath)
      .map((n) => n.filePath as string);
  }, [graph]);

  const coverage = useMemo(
    () => computeDomainCoverage(domainGraph, structuralFilePaths),
    [domainGraph, structuralFilePaths],
  );

  const hasChain = useMemo(
    () =>
      domainGraph ? longestCrossDomainChain(domainGraph).length >= 2 : false,
    [domainGraph],
  );

  if (!domainGraph) return null;

  const jump = (
    domainId: string,
    nodeId: string | null,
    isFlow: boolean,
  ) => {
    setQuery("");
    if (activeDomainId !== domainId) navigateToDomain(domainId);
    if (nodeId) {
      selectNode(nodeId);
      if (isFlow) setFocusedFlow(nodeId);
    }
  };

  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-2 w-[280px]">
      {/* Search box */}
      <div className="w-full relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search domains, flows, steps, entities…"
          className="w-full px-3 py-1.5 text-xs rounded-lg bg-surface border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none"
        />
        {hits.length > 0 && (
          <div className="absolute top-full mt-1 left-0 right-0 max-h-[320px] overflow-auto rounded-lg bg-surface border border-border-medium shadow-2xl py-1">
            {hits.map((h, i) => (
              <button
                key={`${h.kind}-${h.node.id}-${h.entity ?? ""}-${i}`}
                type="button"
                onClick={() =>
                  jump(
                    h.domainId,
                    h.kind === "domain" || h.kind === "entity"
                      ? null
                      : h.node.id,
                    h.kind === "flow",
                  )
                }
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/10 transition-colors"
              >
                <span
                  className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                    h.kind === "domain"
                      ? "bg-node-concept/15 text-node-concept"
                      : h.kind === "flow"
                        ? "bg-node-pipeline/15 text-node-pipeline"
                        : h.kind === "entity"
                          ? "bg-node-entity/15 text-node-entity"
                          : "bg-node-function/15 text-node-function"
                  }`}
                >
                  {h.kind}
                </span>
                <span className="text-[11px] text-text-secondary truncate">
                  {h.entity ?? h.node.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Item 114: entity filter chips (domain-detail view only). */}
      {activeDomainId && activeDomainEntities.length > 0 && (
        <div className="w-full rounded-lg bg-surface border border-border-subtle p-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1.5">
            Filter by entity
          </div>
          <div className="flex flex-wrap gap-1 justify-end">
            {activeDomainEntities.map((ent) => {
              const on = entityFilter === ent;
              return (
                <button
                  key={ent}
                  type="button"
                  onClick={() => setEntityFilter(on ? null : ent)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    on
                      ? "bg-node-entity/20 border-node-entity/50 text-node-entity"
                      : "bg-elevated border-border-subtle text-text-secondary hover:border-node-entity/40"
                  }`}
                >
                  {ent}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-end">
        {/* Item 118: entity glossary panel toggle */}
        {hasEntities && (
          <button
            type="button"
            onClick={() => toggleGlossary()}
            title="Entity glossary — which domains own each entity"
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              glossaryOpen
                ? "bg-node-entity/15 border-node-entity/50 text-node-entity"
                : "bg-surface border-border-subtle text-text-secondary hover:text-text-primary"
            }`}
          >
            Glossary
          </button>
        )}

        {/* Items 117/119: filters popover (entry-type + flow-count). */}
        {!activeDomainId && (
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            title="Filter domains by entry-type and flow count"
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              entryTypeFilter || minFlows > 0
                ? "bg-accent/15 border-accent/50 text-accent"
                : "bg-surface border-border-subtle text-text-secondary hover:text-text-primary"
            }`}
          >
            Filters
            {(entryTypeFilter || minFlows > 0) && (
              <span className="ml-1 text-[9px]">●</span>
            )}
          </button>
        )}

        {/* Storyline toggle (overview only) */}
        {!activeDomainId && hasChain && (
          <button
            type="button"
            onClick={() => toggleStoryline()}
            title="Linearize the longest cross-domain chain"
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              storyline
                ? "bg-accent/15 border-accent/50 text-accent"
                : "bg-surface border-border-subtle text-text-secondary hover:text-text-primary"
            }`}
          >
            {storyline ? "✦ Storyline on" : "Storyline"}
          </button>
        )}

        {/* Coverage meter */}
        <button
          type="button"
          onClick={() => setCoverageOpen((o) => !o)}
          title="Domain coverage of structural files"
          className="px-3 py-1.5 text-xs rounded-lg bg-surface border border-border-subtle text-text-secondary hover:text-text-primary transition-colors flex items-center gap-2"
        >
          <span className="relative inline-block w-16 h-1.5 rounded-full bg-elevated overflow-hidden">
            <span
              className="absolute inset-y-0 left-0 bg-accent"
              style={{ width: `${coverage.percent}%` }}
            />
          </span>
          <span className="font-mono text-accent">{coverage.percent}%</span>
        </button>
      </div>

      {/* Items 117/119: filters popover */}
      {filtersOpen && !activeDomainId && (
        <div className="w-full rounded-lg bg-surface border border-border-medium shadow-2xl p-3 space-y-3">
          {/* Item 119: flow-count / complexity slider */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">
                Min flows
              </span>
              <span className="text-[11px] font-mono text-accent">
                {minFlows === 0 ? "all" : `≥ ${minFlows}`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, maxFlows)}
              step={1}
              value={Math.min(minFlows, Math.max(1, maxFlows))}
              onChange={(e) => setMinFlows(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
            <div className="text-[9px] text-text-muted mt-0.5">
              Hide trivial domains; surface heavy ones.
            </div>
          </div>

          {/* Item 117: entry-type legend & filter */}
          {entryTypes.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
                Entry type
              </div>
              <div className="flex flex-wrap gap-1">
                {entryTypes.map((et) => {
                  const on = entryTypeFilter === et;
                  return (
                    <button
                      key={et}
                      type="button"
                      onClick={() => setEntryTypeFilter(on ? null : et)}
                      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                        on
                          ? "border-accent/60 bg-accent/10 text-text-primary"
                          : "border-border-subtle bg-elevated text-text-secondary hover:border-accent/40"
                      }`}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: ENTRY_TYPE_COLOR[et] }}
                      />
                      {et}
                    </button>
                  );
                })}
                {entryTypeFilter && (
                  <button
                    type="button"
                    onClick={() => setEntryTypeFilter(null)}
                    className="text-[10px] px-1.5 py-0.5 rounded text-text-muted hover:text-accent"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {coverageOpen && (
        <div className="w-full rounded-lg bg-surface border border-border-medium shadow-2xl p-3 text-[11px] space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Domain coverage
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Mapped files</span>
            <span className="font-mono text-accent">
              {coverage.coveredCount} / {coverage.totalFiles}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Unmapped files</span>
            <span className="font-mono text-[#c97070]">
              {coverage.unmappedFiles.length}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
            <div
              className="h-full bg-accent"
              style={{ width: `${coverage.percent}%` }}
            />
          </div>
          {coverage.unmappedFiles.length > 0 && (
            <div className="max-h-[140px] overflow-auto mt-1 space-y-0.5">
              {coverage.unmappedFiles.slice(0, 50).map((f) => (
                <div
                  key={f}
                  className="font-mono text-[9px] text-text-muted truncate"
                  title={f}
                >
                  {f}
                </div>
              ))}
              {coverage.unmappedFiles.length > 50 && (
                <div className="text-[9px] text-text-muted/70">
                  +{coverage.unmappedFiles.length - 50} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

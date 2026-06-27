import { useEffect, useMemo, useRef } from "react";
import { useDashboardStore, ALL_NODE_TYPES, ALL_COMPLEXITIES, ALL_EDGE_CATEGORIES } from "../store";
import type { NodeType, Complexity, EdgeCategory } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { FILTER_PRESETS, presetAvailable } from "../utils/filterPresets";
import { hasGitMeta } from "../utils/gitMeta";

const COMPLEXITY_LABELS = ["simple", "moderate", "complex"] as const;

export default function FilterPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const filters = useDashboardStore((s) => s.filters);
  const setFilters = useDashboardStore((s) => s.setFilters);
  const resetFilters = useDashboardStore((s) => s.resetFilters);
  const hasActiveFilters = useDashboardStore((s) => s.hasActiveFilters);
  const filterPanelOpen = useDashboardStore((s) => s.filterPanelOpen);
  const toggleFilterPanel = useDashboardStore((s) => s.toggleFilterPanel);
  // Items 70/71: tag facet + complexity range — these drive the structural
  // graph directly (separate from the export-time `filters` above).
  const tagFilter = useDashboardStore((s) => s.tagFilter);
  const toggleTagFilter = useDashboardStore((s) => s.toggleTagFilter);
  const clearTagFilter = useDashboardStore((s) => s.clearTagFilter);
  const complexityRange = useDashboardStore((s) => s.complexityRange);
  const setComplexityRange = useDashboardStore((s) => s.setComplexityRange);
  const onlyComplex = useDashboardStore((s) => s.onlyComplex);
  const toggleOnlyComplex = useDashboardStore((s) => s.toggleOnlyComplex);
  // 200-series 72/74/87: connectivity / preset / staleness filters.
  const minDegree = useDashboardStore((s) => s.minDegree);
  const setMinDegree = useDashboardStore((s) => s.setMinDegree);
  const toggleHubsOnly = useDashboardStore((s) => s.toggleHubsOnly);
  const activePreset = useDashboardStore((s) => s.activePreset);
  const setActivePreset = useDashboardStore((s) => s.setActivePreset);
  const recentlyChangedOnly = useDashboardStore((s) => s.recentlyChangedOnly);
  const toggleRecentlyChangedOnly = useDashboardStore((s) => s.toggleRecentlyChangedOnly);
  const staleIndicators = useDashboardStore((s) => s.staleIndicators);
  const toggleStaleIndicators = useDashboardStore((s) => s.toggleStaleIndicators);
  const { t } = useI18n();

  const gitMetaPresent = useMemo(() => hasGitMeta(graph), [graph]);
  const availablePresets = useMemo(
    () => FILTER_PRESETS.filter((p) => presetAvailable(p.id, graph)),
    [graph],
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const allNodeTypes = ALL_NODE_TYPES;
  const allComplexities = ALL_COMPLEXITIES;
  const allEdgeCategories = ALL_EDGE_CATEGORIES;
  const layers = graph?.layers ?? [];

  // Item 70: top-N tags by frequency across the graph.
  const topTags = useMemo(() => {
    if (!graph) return [] as { tag: string; count: number }[];
    const counts = new Map<string, number>();
    for (const n of graph.nodes) {
      for (const tg of n.tags ?? []) counts.set(tg, (counts.get(tg) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [graph]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (filterPanelOpen) {
          toggleFilterPanel();
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterPanelOpen, toggleFilterPanel]);

  const toggleNodeType = (type: NodeType) => {
    const newTypes = new Set(filters.nodeTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setFilters({ nodeTypes: newTypes });
  };

  const toggleComplexity = (complexity: Complexity) => {
    const newComplexities = new Set(filters.complexities);
    if (newComplexities.has(complexity)) {
      newComplexities.delete(complexity);
    } else {
      newComplexities.add(complexity);
    }
    setFilters({ complexities: newComplexities });
  };

  const toggleLayer = (layerId: string) => {
    const newLayers = new Set(filters.layerIds);
    if (newLayers.has(layerId)) {
      newLayers.delete(layerId);
    } else {
      newLayers.add(layerId);
    }
    setFilters({ layerIds: newLayers });
  };

  const toggleEdgeCategory = (category: EdgeCategory) => {
    const newCategories = new Set(filters.edgeCategories);
    if (newCategories.has(category)) {
      newCategories.delete(category);
    } else {
      newCategories.add(category);
    }
    setFilters({ edgeCategories: newCategories });
  };

  const isActive =
    hasActiveFilters() ||
    tagFilter.size > 0 ||
    complexityRange[0] > 0 ||
    complexityRange[1] < 2 ||
    minDegree > 0 ||
    activePreset !== null ||
    recentlyChangedOnly;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleFilterPanel}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
          isActive
            ? "bg-gold/20 text-gold hover:bg-gold/30"
            : "bg-elevated text-text-secondary hover:text-text-primary"
        }`}
        title="Filter graph (F)"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        {t.common.filter}
      </button>

      {filterPanelOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 glass rounded-lg shadow-xl overflow-hidden animate-fade-slide-in z-50">
          <div className="p-4 space-y-4">
            {/* Presets (item 74) — one-click quick filters */}
            {availablePresets.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Presets
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {availablePresets.map((p) => {
                    const active = activePreset === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setActivePreset(p.id)}
                        title={p.hint}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                          active
                            ? "border-gold bg-gold/15 text-gold"
                            : "border-border-subtle bg-elevated text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Node Types */}
            <div>
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {t.filterPanel.nodeTypes}
              </h3>
              <div className="space-y-1.5">
                {allNodeTypes.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.nodeTypes.has(type)}
                      onChange={() => toggleNodeType(type)}
                      className="w-3.5 h-3.5 rounded border-border-subtle bg-elevated checked:bg-gold checked:border-gold focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary capitalize">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Complexity */}
            <div>
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {t.filterPanel.complexity}
              </h3>
              <div className="space-y-1.5">
                {allComplexities.map((complexity) => (
                  <label
                    key={complexity}
                    className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.complexities.has(complexity)}
                      onChange={() => toggleComplexity(complexity)}
                      className="w-3.5 h-3.5 rounded border-border-subtle bg-elevated checked:bg-gold checked:border-gold focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary capitalize">{complexity}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Complexity range slider + only-complex quick button (item 71) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Complexity range
                </h3>
                <button
                  onClick={toggleOnlyComplex}
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
                    onlyComplex
                      ? "border-[#c97070]/50 bg-[#c97070]/10 text-[#c97070]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Only complex
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted w-12 shrink-0">Min</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={1}
                  value={complexityRange[0]}
                  onChange={(e) => setComplexityRange([Number(e.target.value), complexityRange[1]])}
                  className="flex-1 accent-gold"
                />
                <span className="text-[10px] text-text-secondary capitalize w-16 text-right shrink-0">
                  {COMPLEXITY_LABELS[complexityRange[0]]}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-text-muted w-12 shrink-0">Max</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={1}
                  value={complexityRange[1]}
                  onChange={(e) => setComplexityRange([complexityRange[0], Number(e.target.value)])}
                  className="flex-1 accent-gold"
                />
                <span className="text-[10px] text-text-secondary capitalize w-16 text-right shrink-0">
                  {COMPLEXITY_LABELS[complexityRange[1]]}
                </span>
              </div>
            </div>

            {/* Connectivity / degree filter (item 72) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Min connections
                </h3>
                <button
                  onClick={toggleHubsOnly}
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
                    minDegree >= 5
                      ? "border-gold/50 bg-gold/10 text-gold"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                  title="Show only highly-connected hub nodes"
                >
                  Hubs only
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={minDegree}
                  onChange={(e) => setMinDegree(Number(e.target.value))}
                  className="flex-1 accent-gold"
                />
                <span className="text-[10px] text-text-secondary w-10 text-right shrink-0 tabular-nums">
                  {minDegree === 0 ? "off" : `≥ ${minDegree}`}
                </span>
              </div>
            </div>

            {/* Staleness / recently-changed (item 87) */}
            {gitMetaPresent && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Freshness
                </h3>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1 transition-colors">
                    <input
                      type="checkbox"
                      checked={recentlyChangedOnly}
                      onChange={toggleRecentlyChangedOnly}
                      className="w-3.5 h-3.5 rounded border-border-subtle bg-elevated checked:bg-gold checked:border-gold focus:ring-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary">Recently changed only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1 transition-colors">
                    <input
                      type="checkbox"
                      checked={staleIndicators}
                      onChange={toggleStaleIndicators}
                      className="w-3.5 h-3.5 rounded border-border-subtle bg-elevated checked:bg-gold checked:border-gold focus:ring-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary">Show change-age dots</span>
                  </label>
                </div>
              </div>
            )}

            {/* Tag facet — multi-select top tags (item 70) */}
            {topTags.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    Tags
                  </h3>
                  {tagFilter.size > 0 && (
                    <button
                      onClick={clearTagFilter}
                      className="text-[10px] text-gold hover:text-gold-bright transition-colors"
                    >
                      Clear ({tagFilter.size})
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {topTags.map(({ tag, count }) => {
                    const active = tagFilter.has(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTagFilter(tag)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                          active
                            ? "border-gold bg-gold/15 text-gold"
                            : "border-border-subtle bg-elevated text-text-secondary hover:text-text-primary"
                        }`}
                        title={`${count} node${count === 1 ? "" : "s"}`}
                      >
                        {tag}
                        <span className="ml-1 text-text-muted">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Layers */}
            {layers.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  {t.filterPanel.layers}
                </h3>
                <div className="space-y-1.5">
                  {layers.map((layer) => (
                    <label
                      key={layer.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={filters.layerIds.has(layer.id)}
                        onChange={() => toggleLayer(layer.id)}
                        className="w-3.5 h-3.5 rounded border-border-subtle bg-elevated checked:bg-gold checked:border-gold focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <div className="w-2 h-2 rounded-full bg-gold/50 shrink-0" />
                      <span className="text-sm text-text-primary">{layer.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Edge Categories */}
            <div>
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {t.filterPanel.edgeCategories}
              </h3>
              <div className="space-y-1.5">
                {allEdgeCategories.map((category) => (
                  <label
                    key={category}
                    className="flex items-center gap-2 cursor-pointer hover:bg-elevated/50 rounded px-2 py-1 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.edgeCategories.has(category)}
                      onChange={() => toggleEdgeCategory(category)}
                      className="w-3.5 h-3.5 rounded border-border-subtle bg-elevated checked:bg-gold checked:border-gold focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-text-primary capitalize">
                      {category.replace(/-/g, " ")}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Reset Button */}
            {isActive && (
              <button
                onClick={() => {
                  resetFilters();
                  clearTagFilter();
                  setComplexityRange([0, 2]);
                  setMinDegree(0);
                  setActivePreset(null);
                  if (recentlyChangedOnly) toggleRecentlyChangedOnly();
                }}
                className="w-full px-3 py-1.5 text-sm bg-elevated hover:bg-gold/20 text-text-secondary hover:text-gold rounded-lg transition-colors"
              >
                {t.common.resetAll}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { federatedSearch, routeForResult } from "../utils/federatedSearch";
import { domainSubgraphNodeIds } from "../utils/domainHelpers";

const typeBadgeColors: Record<string, string> = {
  file: "text-node-file border border-node-file/30 bg-node-file/10",
  function: "text-node-function border border-node-function/30 bg-node-function/10",
  class: "text-node-class border border-node-class/30 bg-node-class/10",
  module: "text-node-module border border-node-module/30 bg-node-module/10",
  concept: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  config: "text-node-config border border-node-config/30 bg-node-config/10",
  document: "text-node-document border border-node-document/30 bg-node-document/10",
  service: "text-node-service border border-node-service/30 bg-node-service/10",
  table: "text-node-table border border-node-table/30 bg-node-table/10",
  endpoint: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  pipeline: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  schema: "text-node-schema border border-node-schema/30 bg-node-schema/10",
  resource: "text-node-resource border border-node-resource/30 bg-node-resource/10",
  domain: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  flow: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  step: "text-node-function border border-node-function/30 bg-node-function/10",
};

export default function SearchBar() {
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);
  const openSearchResult = useDashboardStore((s) => s.openSearchResult);
  const searchMode = useDashboardStore((s) => s.searchMode);
  const setSearchMode = useDashboardStore((s) => s.setSearchMode);
  // 200-series item 67: result cycling counter.
  const searchCycleIndex = useDashboardStore((s) => s.searchCycleIndex);
  const cycleSearchResult = useDashboardStore((s) => s.cycleSearchResult);
  // 200-series item 69: recent + starred searches.
  const searchHistory = useDashboardStore((s) => s.searchHistory);
  const commitRecentSearch = useDashboardStore((s) => s.commitRecentSearch);
  const toggleStarredSearch = useDashboardStore((s) => s.toggleStarredSearch);
  // 200-series item 188: scope search to the current view's subgraph.
  const viewMode = useDashboardStore((s) => s.viewMode);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const searchScopedToView = useDashboardStore((s) => s.searchScopedToView);
  const toggleSearchScopedToView = useDashboardStore(
    (s) => s.toggleSearchScopedToView,
  );
  const { t } = useI18n();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Items 185/186: federate structural (SearchEngine-scored) + domain
  // flows/steps + symbols, each carrying its best-view route + a type badge.
  const federated = useMemo(() => {
    const structuralHits = searchResults.map((r) => ({
      nodeId: r.nodeId,
      score: r.score,
    }));
    // In regex mode the store-side regexSearch already produced the matching
    // node set; keep its ordering by feeding the hits to the federator.
    const all = federatedSearch(
      searchQuery,
      graph,
      domainGraph,
      structuralHits.length > 0 ? structuralHits : undefined,
      24,
    );
    // Item 188: when scoping to the current view, drop domain results outside
    // the active domain's subgraph. (Structural hits are already scoped in the
    // store via computeViewScopeIds before they reach federatedSearch.)
    if (
      searchScopedToView &&
      viewMode === "domain" &&
      activeDomainId &&
      domainGraph
    ) {
      const allowed = domainSubgraphNodeIds(domainGraph, activeDomainId);
      return all.filter(
        (r) => r.realm !== "domain" && r.realm !== "step"
          ? true
          : allowed.has(r.nodeId),
      );
    }
    return all;
  }, [
    searchQuery,
    graph,
    domainGraph,
    searchResults,
    searchScopedToView,
    viewMode,
    activeDomainId,
  ]);

  const topResults = federated.slice(0, 6);
  const isStarred = !!searchQuery.trim() && searchHistory.starred.includes(searchQuery.trim());

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
      setDropdownOpen(true);
    },
    [setSearchQuery],
  );

  const handleResultClick = useCallback(
    (nodeId: string, route: "trace" | "domain" | "structural" | "code", domainId?: string) => {
      openSearchResult(nodeId, route, domainId);
      commitRecentSearch(searchQuery);
      setDropdownOpen(false);
    },
    [openSearchResult, commitRecentSearch, searchQuery],
  );

  // Item 188: toggle scope, then re-run the active query so the store re-filters
  // structural hits against the (now changed) view-scope set.
  const handleToggleScope = useCallback(() => {
    toggleSearchScopedToView();
    if (searchQuery.trim()) setSearchQuery(searchQuery);
  }, [toggleSearchScopedToView, searchQuery, setSearchQuery]);

  // Item 188: human label for what "this view" scopes to right now.
  const scopeLabel =
    viewMode === "trace"
      ? "this trace"
      : viewMode === "domain" && activeDomainId
        ? "this domain"
        : viewMode === "structural"
          ? "this layer"
          : "this view";
  // Only meaningful when there is an actual subgraph to scope to.
  const scopeAvailable =
    viewMode === "trace" ||
    (viewMode === "domain" && !!activeDomainId) ||
    viewMode === "structural";

  const applyHistoryQuery = useCallback(
    (q: string) => {
      setSearchQuery(q);
      setDropdownOpen(true);
      inputRef.current?.focus();
    },
    [setSearchQuery],
  );

  // Close dropdown on Escape; commit recent on Enter.
  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        inputRef.current?.blur();
      } else if (e.key === "Enter") {
        commitRecentSearch(searchQuery);
        // Item 67: Enter cycles to the next match (Shift+Enter = previous).
        if (searchResults.length > 0) cycleSearchResult(e.shiftKey ? -1 : 1);
      }
    },
    [commitRecentSearch, searchQuery, searchResults.length, cycleSearchResult],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasQuery = !!searchQuery.trim();
  const showResults = dropdownOpen && hasQuery && topResults.length > 0;
  // Item 69: when the box is empty + focused, show recent/starred instead.
  const showHistory =
    dropdownOpen &&
    !hasQuery &&
    (searchHistory.recent.length > 0 || searchHistory.starred.length > 0);

  const routeHint: Record<string, string> = {
    trace: "trace",
    domain: "domain",
    structural: "graph",
    code: "code",
  };

  const modeButton = (mode: "fuzzy" | "semantic" | "regex", label: string) => (
    <button
      onClick={() => setSearchMode(mode)}
      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
        searchMode === mode
          ? "bg-accent/20 text-accent"
          : "text-text-muted hover:text-text-secondary"
      }`}
      title={
        mode === "regex"
          ? "Regex / glob over name & filePath (e.g. **/handlers/*.go)"
          : undefined
      }
    >
      {label}
    </button>
  );

  return (
    <div ref={containerRef} className="relative z-30">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-surface border-b border-border-subtle">
        <svg
          className="w-4 h-4 text-text-muted shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={() => setDropdownOpen(true)}
          onKeyDown={handleKey}
          placeholder={
            searchMode === "regex"
              ? "Regex / glob (try **/handlers/*.go, type:function …)"
              : t.search.placeholder
          }
          data-testid="search-input"
          className="flex-1 min-w-0 bg-elevated text-text-primary text-sm rounded-lg px-3 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
        />
        {/* Item 69: star the current query */}
        {hasQuery && (
          <button
            onClick={() => toggleStarredSearch(searchQuery)}
            className={`text-sm shrink-0 transition-colors ${
              isStarred ? "text-gold" : "text-text-muted hover:text-text-secondary"
            }`}
            title={isStarred ? "Unstar this search" : "Star this search"}
            aria-pressed={isStarred}
          >
            {isStarred ? "★" : "☆"}
          </button>
        )}
        {/* Item 67: prev/next cycle controls + counter */}
        {hasQuery && searchResults.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <button
              onClick={() => cycleSearchResult(-1)}
              className="text-text-muted hover:text-text-primary text-xs px-1 rounded"
              title="Previous match (Shift+Enter, N)"
              aria-label="Previous match"
            >
              ‹
            </button>
            <span className="text-[11px] font-mono text-text-secondary tabular-nums">
              {searchCycleIndex >= 0 ? searchCycleIndex + 1 : 0} / {searchResults.length}
            </span>
            <button
              onClick={() => cycleSearchResult(1)}
              className="text-text-muted hover:text-text-primary text-xs px-1 rounded"
              title="Next match (Enter, n)"
              aria-label="Next match"
            >
              ›
            </button>
          </div>
        )}
        <div className="flex items-center gap-1 bg-elevated rounded-lg p-0.5 shrink-0">
          {modeButton("fuzzy", t.search.fuzzy)}
          {modeButton("semantic", t.search.semantic)}
          {modeButton("regex", "Regex")}
        </div>
        {/* Item 188: scope search to the current view's subgraph */}
        {scopeAvailable && (
          <button
            onClick={handleToggleScope}
            className={`hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded-lg border shrink-0 transition-colors ${
              searchScopedToView
                ? "bg-accent/15 border-accent/50 text-accent"
                : "bg-elevated border-border-subtle text-text-muted hover:text-text-secondary"
            }`}
            title={`Limit results to ${scopeLabel}`}
            aria-pressed={searchScopedToView}
          >
            {searchScopedToView ? "◎" : "○"} in {scopeLabel}
          </button>
        )}
        {hasQuery && (
          <span className="hidden md:inline text-xs text-text-muted shrink-0">
            {federated.length} {t.search.result}{federated.length !== 1 ? "s" : ""}{" "}
            <span className="text-text-muted">({searchMode})</span>
          </span>
        )}
      </div>

      {/* Dropdown results — federated across structural / domain / symbols */}
      {showResults && (
        <div className="absolute left-4 right-4 top-full mt-0.5 glass rounded-lg shadow-xl overflow-hidden">
          {topResults.map((result) => {
            const route = routeForResult(result);
            const badgeColor =
              typeBadgeColors[result.nodeType] ?? typeBadgeColors.file;

            return (
              <button
                key={`${result.realm}-${result.nodeId}`}
                type="button"
                onClick={() => handleResultClick(result.nodeId, route.primary, result.domainId)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-elevated transition-colors text-left"
              >
                {/* Type / realm badge */}
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeColor} shrink-0 w-16 text-center`}
                >
                  {result.badge}
                </span>

                {/* Node name */}
                <span className="text-sm text-text-primary truncate flex-1">
                  {result.name}
                </span>

                {/* Best-view route hint */}
                <span className="text-[10px] font-mono text-text-muted shrink-0">
                  → {routeHint[route.primary]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Item 69: recent + starred searches when the box is empty */}
      {showHistory && (
        <div className="absolute left-4 right-4 top-full mt-0.5 glass rounded-lg shadow-xl overflow-hidden max-h-80 overflow-y-auto">
          {searchHistory.starred.length > 0 && (
            <div className="px-3 pt-2 pb-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                Starred
              </div>
              {searchHistory.starred.map((q) => (
                <div
                  key={`star-${q}`}
                  className="group flex items-center gap-2 px-1 py-1 rounded hover:bg-elevated"
                >
                  <button
                    type="button"
                    onClick={() => applyHistoryQuery(q)}
                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                  >
                    <span className="text-gold text-sm shrink-0">★</span>
                    <span className="text-sm text-text-primary truncate">{q}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStarredSearch(q)}
                    className="text-text-muted hover:text-text-secondary text-xs opacity-0 group-hover:opacity-100"
                    title="Unstar"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {searchHistory.recent.length > 0 && (
            <div className="px-3 pt-2 pb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                Recent
              </div>
              {searchHistory.recent.map((q) => (
                <button
                  key={`recent-${q}`}
                  type="button"
                  onClick={() => applyHistoryQuery(q)}
                  className="w-full flex items-center gap-2 px-1 py-1 rounded hover:bg-elevated text-left"
                >
                  <span className="text-text-muted text-xs shrink-0">↻</span>
                  <span className="text-sm text-text-secondary truncate">{q}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

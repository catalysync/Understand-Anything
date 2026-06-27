import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { federatedSearch, routeForResult } from "../utils/federatedSearch";

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
    return federatedSearch(
      searchQuery,
      graph,
      domainGraph,
      structuralHits.length > 0 ? structuralHits : undefined,
      8,
    );
  }, [searchQuery, graph, domainGraph, searchResults]);

  const topResults = federated.slice(0, 6);

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
      setDropdownOpen(false);
    },
    [openSearchResult],
  );

  // Close dropdown on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const showDropdown = dropdownOpen && !!searchQuery.trim() && topResults.length > 0;

  const routeHint: Record<string, string> = {
    trace: "trace",
    domain: "domain",
    structural: "graph",
    code: "code",
  };

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
          placeholder={t.search.placeholder}
          data-testid="search-input"
          className="flex-1 min-w-0 bg-elevated text-text-primary text-sm rounded-lg px-3 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted"
        />
        <div className="flex items-center gap-1 bg-elevated rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setSearchMode("fuzzy")}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              searchMode === "fuzzy"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.search.fuzzy}
          </button>
          <button
            onClick={() => setSearchMode("semantic")}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              searchMode === "semantic"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.search.semantic}
          </button>
        </div>
        {searchQuery.trim() && (
          <span className="hidden sm:inline text-xs text-text-muted shrink-0">
            {federated.length} {t.search.result}{federated.length !== 1 ? "s" : ""}{" "}
            <span className="text-text-muted">({searchMode})</span>
          </span>
        )}
      </div>

      {/* Dropdown results — federated across structural / domain / symbols */}
      {showDropdown && (
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
    </div>
  );
}

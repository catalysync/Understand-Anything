// ── Recent + starred searches (200-series item 69) ──────────────────────────
//
// Persisted to localStorage (NOT workspace.json — the server whitelist drops
// unknown keys), namespaced per project. Recents are an MRU list capped at
// MAX_RECENT; stars are an unbounded set of pinned queries.

const RECENT_KEY_PREFIX = "ua-search-recent-v1:";
const STARRED_KEY_PREFIX = "ua-search-starred-v1:";
const MAX_RECENT = 12;

export interface SearchHistory {
  recent: string[];
  starred: string[];
}

export const EMPTY_SEARCH_HISTORY: SearchHistory = { recent: [], starred: [] };

function recentKey(p: string): string {
  return `${RECENT_KEY_PREFIX}${p || "default"}`;
}
function starredKey(p: string): string {
  return `${STARRED_KEY_PREFIX}${p || "default"}`;
}

function readList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* ignore */
  }
  return [];
}

function writeList(key: string, list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function loadSearchHistory(projectKey: string): SearchHistory {
  return {
    recent: readList(recentKey(projectKey)),
    starred: readList(starredKey(projectKey)),
  };
}

/** Push a query to the front of the MRU recents (deduped, capped). */
export function pushRecentSearch(history: SearchHistory, query: string): SearchHistory {
  const q = query.trim();
  if (!q) return history;
  const recent = [q, ...history.recent.filter((r) => r !== q)].slice(0, MAX_RECENT);
  return { ...history, recent };
}

/** Toggle a query in the starred set. */
export function toggleStarredSearch(history: SearchHistory, query: string): SearchHistory {
  const q = query.trim();
  if (!q) return history;
  const has = history.starred.includes(q);
  const starred = has
    ? history.starred.filter((s) => s !== q)
    : [q, ...history.starred];
  return { ...history, starred };
}

export function saveSearchHistory(projectKey: string, history: SearchHistory): void {
  writeList(recentKey(projectKey), history.recent);
  writeList(starredKey(projectKey), history.starred);
}

// Item 199: a shared LRU cache for line/range explanations, keyed by
// `path:start:end(:session)`. An explanation produced in one view (CodeViewer)
// is instant in another (TraceView) for the same code range. Plus a single
// in-flight AbortController so switching focus cancels a stale `claude -p` POST.
//
// Module-level (not in the zustand store) so it survives component unmounts and
// is shared across every consumer of useCodeAssist without prop-drilling.

export interface CachedExplain {
  explanation: string;
  sessionId: string | null;
}

const MAX_ENTRIES = 40;

// Insertion-order Map doubles as an LRU: on get we re-insert to mark recent.
const cache = new Map<string, CachedExplain>();

export function explainCacheKey(
  path: string,
  start: number,
  end: number,
  session?: string | null,
): string {
  return `${path}:${start}:${end}${session ? `:${session}` : ""}`;
}

export function getCachedExplain(key: string): CachedExplain | undefined {
  const hit = cache.get(key);
  if (hit) {
    // Mark as most-recently-used.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function setCachedExplain(key: string, value: CachedExplain): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  // Evict the least-recently-used entries beyond the cap.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearExplainCache(): void {
  cache.clear();
}

// ---- Single shared in-flight AbortController -------------------------------
//
// Each new explain() / runMode() call aborts the previous one (focus changed),
// so we never leave a 10–20s `claude -p` POST hanging after the user moved on.

let inflight: AbortController | null = null;

/** Abort any in-flight explain request and start a fresh controller. */
export function freshAbortController(): AbortController {
  if (inflight) {
    try {
      inflight.abort();
    } catch {
      /* ignore */
    }
  }
  inflight = new AbortController();
  return inflight;
}

/** Abort the current in-flight request (e.g. on focus change / unmount). */
export function abortInflightExplain(): void {
  if (inflight) {
    try {
      inflight.abort();
    } catch {
      /* ignore */
    }
    inflight = null;
  }
}

/** True if an error is an abort (so callers can swallow it silently). */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "AbortError" || err.code === 20)
  ) || (err instanceof Error && err.name === "AbortError");
}

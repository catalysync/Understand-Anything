// ── Search scope / mode helpers (200-series items 65/66) ────────────────────
//
// Two orthogonal query features layered on top of the fuzzy SearchEngine:
//
//   65. Regex / glob mode — match `name` / `filePath` by a JS regex or a
//       `**/x/*.go`-style glob (compiled to a regex). The SearchBar's third
//       mode button ("regex") flips `searchMode` to "regex".
//
//   66. Scoped prefixes — `type:function`, `layer:Data`, `tag:security`,
//       `pkg:httpx` recognised in ANY mode. They are stripped from the query
//       and used to constrain the candidate set BEFORE ranking. Multiple
//       prefixes AND together; the remaining free text is fuzzy/regex matched.
//
// Everything is defensive: an invalid regex/glob yields zero matches (never
// throws), and unknown prefixes are left in the free text.

import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

export type ScopeKind = "type" | "layer" | "tag" | "pkg";

export interface SearchScope {
  /** Recognised `key:value` prefixes (lower-cased values). */
  readonly type: string[];
  readonly layer: string[];
  readonly tag: string[];
  readonly pkg: string[];
  /** The query with all recognised prefixes removed (the free-text part). */
  readonly rest: string;
  /** True when at least one prefix was recognised. */
  readonly hasScope: boolean;
}

const SCOPE_KEYS: ScopeKind[] = ["type", "layer", "tag", "pkg"];
const SCOPE_RE = /\b(type|layer|tag|pkg):("[^"]+"|\S+)/gi;

/** Parse `type:function tag:security foo` into structured scopes + free text. */
export function parseScopes(query: string): SearchScope {
  const buckets: Record<ScopeKind, string[]> = {
    type: [],
    layer: [],
    tag: [],
    pkg: [],
  };
  let hasScope = false;
  const rest = query
    .replace(SCOPE_RE, (_m, key: string, rawVal: string) => {
      const k = key.toLowerCase() as ScopeKind;
      if (!SCOPE_KEYS.includes(k)) return _m;
      const val = rawVal.replace(/^"|"$/g, "").toLowerCase();
      if (val) {
        buckets[k].push(val);
        hasScope = true;
      }
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { ...buckets, rest, hasScope };
}

/**
 * Compile a glob (`**`, `*`, `?`) OR a raw regex into a RegExp. Heuristic:
 * a query containing glob-ish chars but no regex-only metachars is treated as
 * a glob; otherwise it's compiled directly as a regex. Returns null on error.
 */
export function compilePattern(raw: string): RegExp | null {
  const q = raw.trim();
  if (!q) return null;
  const looksGlob = /[*?]/.test(q) && !/[()[\]{}+^$\\|]/.test(q);
  try {
    if (looksGlob) {
      // Escape regex specials, then translate glob tokens.
      let re = "";
      for (let i = 0; i < q.length; i++) {
        const c = q[i];
        if (c === "*") {
          if (q[i + 1] === "*") {
            re += ".*";
            i++;
            // consume a trailing slash after ** so `**/x` matches `x` too
            if (q[i + 1] === "/") i++;
          } else {
            re += "[^/]*";
          }
        } else if (c === "?") {
          re += "[^/]";
        } else if (/[.+^${}()|[\]\\]/.test(c)) {
          re += "\\" + c;
        } else {
          re += c;
        }
      }
      return new RegExp(re, "i");
    }
    return new RegExp(q, "i");
  } catch {
    return null;
  }
}

/** Does this node pass ALL of the structured scope constraints? */
export function nodeMatchesScope(
  node: GraphNode,
  scope: SearchScope,
  layerIdsByNodeId: Map<string, Set<string>>,
  layerNameById: Map<string, string>,
): boolean {
  if (scope.type.length > 0) {
    if (!scope.type.includes(node.type.toLowerCase())) return false;
  }
  if (scope.tag.length > 0) {
    const tags = (node.tags ?? []).map((t) => t.toLowerCase());
    if (!scope.tag.some((want) => tags.includes(want))) return false;
  }
  if (scope.pkg.length > 0) {
    const fp = (node.filePath ?? "").toLowerCase();
    if (!scope.pkg.some((want) => fp.includes(want))) return false;
  }
  if (scope.layer.length > 0) {
    const lids = layerIdsByNodeId.get(node.id);
    if (!lids) return false;
    let ok = false;
    for (const lid of lids) {
      const lname = (layerNameById.get(lid) ?? lid).toLowerCase();
      if (scope.layer.some((want) => lname.includes(want))) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

/**
 * Run a regex/glob query over the graph's nodes, matching `name` OR `filePath`.
 * Returns `SearchResult`-shaped hits (score derived from match position so the
 * SearchBar's existing ranking + federation keep working). Empty on bad pattern.
 */
export function regexSearch(
  pattern: RegExp,
  nodes: GraphNode[],
  limit = 50,
): { nodeId: string; score: number }[] {
  const hits: { nodeId: string; score: number }[] = [];
  for (const n of nodes) {
    const name = n.name ?? "";
    const fp = n.filePath ?? "";
    const mName = name.match(pattern);
    const mPath = mName ? null : fp.match(pattern);
    const m = mName ?? mPath;
    if (!m) continue;
    // Earlier + longer matches rank better. score 0 = best.
    const idx = m.index ?? 0;
    const target = (mName ? name : fp) || "1";
    const score = Math.min(0.99, idx / Math.max(1, target.length) * 0.5);
    hits.push({ nodeId: n.id, score });
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, limit);
}

/** Build the layer-name lookup used by `nodeMatchesScope` from a graph. */
export function buildLayerNameMap(
  graph: KnowledgeGraph | null,
): Map<string, string> {
  const m = new Map<string, string>();
  if (!graph) return m;
  for (const l of graph.layers) m.set(l.id, l.name);
  return m;
}

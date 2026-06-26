// Wave-1 trace-navigation graph helpers. Pure functions over the
// KnowledgeGraph — no React, no store. Kept separate so TraceView stays
// focused on rendering and so these can be unit-reasoned about in isolation.
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

export type TraceDirection = "callees" | "callers";

/** Derive a node's "package" from its filePath directory. */
export function packageOf(node: GraphNode | undefined): string {
  if (!node?.filePath) return "(none)";
  const path = node.filePath;
  const slash = path.lastIndexOf("/");
  if (slash <= 0) return "(root)";
  return path.slice(0, slash);
}

/** A short, human label for a package (last 2 path segments). */
export function packageLabel(pkg: string): string {
  if (pkg === "(none)" || pkg === "(root)") return pkg;
  const parts = pkg.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

/** Packages we default-mute: runtime, net/http, and obvious stdlib-ish dirs. */
const DEFAULT_MUTE_HINTS = [
  "runtime",
  "net/http",
  "net\\http",
  "/http",
  "syscall",
  "reflect",
  "sync",
  "vendor",
  "node_modules",
  "internal/poll",
];

/** Given the packages present in a trace, pick the ones to default-mute. */
export function defaultMutedPackages(pkgs: string[]): string[] {
  return pkgs.filter((p) => {
    const lower = p.toLowerCase();
    return DEFAULT_MUTE_HINTS.some((h) => lower.includes(h));
  });
}

/** Outgoing `calls` targets for a node (callees). */
export function callTargets(graph: KnowledgeGraph, id: string): GraphNode[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.source === id && e.type === "calls")
    .map((e) => nodesById.get(e.target))
    .filter((n): n is GraphNode => n !== undefined);
}

/** Incoming `calls` sources for a node (callers). */
export function callersOf(graph: KnowledgeGraph, id: string): GraphNode[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.target === id && e.type === "calls")
    .map((e) => nodesById.get(e.source))
    .filter((n): n is GraphNode => n !== undefined);
}

/**
 * Build the ordered chain from a focus node. Direction "callees" walks
 * outgoing `calls` (+ `contains` to surface a file's functions). Direction
 * "callers" walks incoming `calls`. Dedups by id, preserves first-visit order.
 */
export function buildTrace(
  graph: KnowledgeGraph,
  focusId: string,
  maxDepth = 4,
  direction: TraceDirection = "callees",
): GraphNode[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const ordered: GraphNode[] = [];
  const seen = new Set<string>();

  const visit = (id: string, depth: number) => {
    if (seen.has(id) || depth > maxDepth) return;
    const node = nodesById.get(id);
    if (!node) return;
    seen.add(id);
    ordered.push(node);
    if (direction === "callees") {
      const next = graph.edges
        .filter((e) => e.source === id && (e.type === "calls" || e.type === "contains"))
        .sort((a, b) => (a.type === b.type ? 0 : a.type === "calls" ? -1 : 1));
      for (const e of next) visit(e.target, depth + 1);
    } else {
      const next = graph.edges.filter((e) => e.target === id && e.type === "calls");
      for (const e of next) visit(e.source, depth + 1);
    }
  };

  visit(focusId, 0);
  return ordered;
}

const complexityWeight: Record<string, number> = { simple: 1, moderate: 2, complex: 3 };

/**
 * Longest call chain from the root following `calls` edges (callees). Ties
 * broken by higher cumulative complexity, then by out-degree (call count).
 * Returns the set of node ids on the critical path.
 */
export function criticalPath(
  graph: KnowledgeGraph,
  rootId: string,
  direction: TraceDirection = "callees",
): Set<string> {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const outDegree = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type !== "calls") continue;
    const key = direction === "callees" ? e.source : e.target;
    outDegree.set(key, (outDegree.get(key) ?? 0) + 1);
  }

  const nextOf = (id: string): string[] =>
    direction === "callees"
      ? graph.edges.filter((e) => e.source === id && e.type === "calls").map((e) => e.target)
      : graph.edges.filter((e) => e.target === id && e.type === "calls").map((e) => e.source);

  // DFS with cycle guard, tracking best path by (length, complexity, degree).
  const inStack = new Set<string>();
  type Best = { ids: string[]; len: number; cx: number; deg: number };
  const memo = new Map<string, Best>();

  const score = (id: string): Best => {
    if (memo.has(id)) return memo.get(id)!;
    if (inStack.has(id)) return { ids: [id], len: 1, cx: 0, deg: 0 };
    inStack.add(id);
    const node = nodesById.get(id);
    const selfCx = node ? complexityWeight[node.complexity] ?? 1 : 1;
    const selfDeg = outDegree.get(id) ?? 0;
    let best: Best | null = null;
    for (const nxt of nextOf(id)) {
      if (inStack.has(nxt)) continue;
      const sub = score(nxt);
      if (
        !best ||
        sub.len > best.len ||
        (sub.len === best.len && sub.cx > best.cx) ||
        (sub.len === best.len && sub.cx === best.cx && sub.deg > best.deg)
      ) {
        best = sub;
      }
    }
    inStack.delete(id);
    const result: Best = best
      ? { ids: [id, ...best.ids], len: best.len + 1, cx: best.cx + selfCx, deg: best.deg + selfDeg }
      : { ids: [id], len: 1, cx: selfCx, deg: selfDeg };
    memo.set(id, result);
    return result;
  };

  return new Set(score(rootId).ids);
}

/**
 * Shortest path (BFS) from `fromId` to `toId` over `calls` (+ optionally
 * `imports`) edges. Returns the ordered node ids, or null if unreachable.
 */
export function pathBetween(
  graph: KnowledgeGraph,
  fromId: string,
  toId: string,
  includeImports = true,
): string[] | null {
  if (fromId === toId) return [fromId];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type !== "calls" && !(includeImports && e.type === "imports")) continue;
    let list = adj.get(e.source);
    if (!list) {
      list = [];
      adj.set(e.source, list);
    }
    list.push(e.target);
  }
  const queue: string[] = [fromId];
  const prev = new Map<string, string>();
  const visited = new Set<string>([fromId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (visited.has(nxt)) continue;
      visited.add(nxt);
      prev.set(nxt, cur);
      if (nxt === toId) {
        const path = [nxt];
        let p = cur;
        while (p !== fromId) {
          path.unshift(p);
          p = prev.get(p)!;
        }
        path.unshift(fromId);
        return path;
      }
      queue.push(nxt);
    }
  }
  return null;
}

/**
 * Group a node's callees by package. Used for bundled edges: when a hop has
 * many calls into the SAME package, collapse to one expandable row.
 */
export function bundleCalleesByPackage(
  graph: KnowledgeGraph,
  id: string,
): { pkg: string; nodes: GraphNode[] }[] {
  const targets = callTargets(graph, id);
  const byPkg = new Map<string, GraphNode[]>();
  for (const t of targets) {
    const pkg = packageOf(t);
    let list = byPkg.get(pkg);
    if (!list) {
      list = [];
      byPkg.set(pkg, list);
    }
    list.push(t);
  }
  return [...byPkg.entries()].map(([pkg, nodes]) => ({ pkg, nodes }));
}

/** Distinct packages present across a set of hops. */
export function packagesIn(nodes: GraphNode[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) set.add(packageOf(n));
  return [...set].sort();
}

/** True if a node name matches one of the fold patterns (substring / simple glob). */
export function matchesFoldPattern(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p.includes("*")) {
      // simple glob → regex
      const re = new RegExp(
        "^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      if (re.test(lower)) return true;
    } else if (lower.includes(p)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wave-2 code-intelligence helpers (references, implementations, signatures,
// containment breadcrumb, concurrency detection, fuzzy symbol search).
// ---------------------------------------------------------------------------

export interface Reference {
  node: GraphNode;
  /** Why this is a reference: a direct call or an import of the defining file. */
  kind: "calls" | "imports";
}

/**
 * All references to a node: incoming `calls` (callers) plus incoming `imports`
 * that target the node OR the file that contains the node. Grouped/dedup by id,
 * preferring "calls" when a node both calls and imports.
 */
export function referencesOf(graph: KnowledgeGraph, id: string): Reference[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = nodesById.get(id);
  // The file node that contains this node (so import-of-file counts as a ref).
  const fileId = graph.edges.find((e) => e.type === "contains" && e.target === id)?.source;
  const byId = new Map<string, Reference>();
  for (const e of graph.edges) {
    let isRef = false;
    let kind: "calls" | "imports" = "calls";
    if (e.type === "calls" && e.target === id) {
      isRef = true;
      kind = "calls";
    } else if (e.type === "imports" && (e.target === id || (fileId && e.target === fileId))) {
      isRef = true;
      kind = "imports";
    }
    if (!isRef) continue;
    const src = nodesById.get(e.source);
    if (!src || src.id === id || src.id === node?.id) continue;
    const existing = byId.get(src.id);
    // Prefer "calls" over "imports" for the same source.
    if (!existing || (existing.kind === "imports" && kind === "calls")) {
      byId.set(src.id, { node: src, kind });
    }
  }
  return [...byId.values()];
}

/** Group references by the file they live in (filePath). */
export function groupReferencesByFile(refs: Reference[]): { file: string; refs: Reference[] }[] {
  const byFile = new Map<string, Reference[]>();
  for (const r of refs) {
    const file = r.node.filePath ?? "(unknown)";
    let list = byFile.get(file);
    if (!list) {
      list = [];
      byFile.set(file, list);
    }
    list.push(r);
  }
  return [...byFile.entries()]
    .map(([file, list]) => ({ file, refs: list }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Concrete implementations of an interface node: sources of `implements` edges
 * whose target is `id`. Returns [] if the node has no implementors.
 */
export function implementationsOf(graph: KnowledgeGraph, id: string): GraphNode[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.type === "implements" && e.target === id)
    .map((e) => nodesById.get(e.source))
    .filter((n): n is GraphNode => n !== undefined);
}

/**
 * Interfaces a node implements: targets of `implements` edges whose source is
 * `id`. Returns [] if the node implements nothing.
 */
export function interfacesOf(graph: KnowledgeGraph, id: string): GraphNode[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.type === "implements" && e.source === id)
    .map((e) => nodesById.get(e.target))
    .filter((n): n is GraphNode => n !== undefined);
}

/** Number of incoming `calls` edges (a cheap "popularity"/ref-count). */
export function callCountOf(graph: KnowledgeGraph, id: string): number {
  let n = 0;
  for (const e of graph.edges) if (e.type === "calls" && e.target === id) n++;
  return n;
}

/**
 * Pull the one-line "signature" of a node from full file source: the first
 * non-blank, non-comment line at/after the node's lineRange start. Pragmatic —
 * for Go this is the `func`/`type` declaration line. Returns null if we can't.
 */
export function signatureFromSource(
  fullSource: string | undefined,
  node: GraphNode | undefined,
): string | null {
  if (!fullSource || !node?.lineRange) return null;
  const lines = fullSource.split("\n");
  const start = Math.max(0, node.lineRange[0] - 1);
  const end = Math.min(lines.length, node.lineRange[1]);
  for (let i = start; i < end; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    // Trim a trailing opening brace for compactness.
    return trimmed.replace(/\s*\{\s*$/, "");
  }
  return null;
}

/** Containment breadcrumb for a hop header: pkg › file › name. */
export function containmentBreadcrumb(node: GraphNode | undefined): {
  pkg: string;
  file: string;
  name: string;
} {
  if (!node) return { pkg: "—", file: "—", name: "—" };
  const path = node.filePath ?? "";
  const slash = path.lastIndexOf("/");
  const file = slash >= 0 ? path.slice(slash + 1) : path || "—";
  const pkg = slash > 0 ? packageLabel(path.slice(0, slash)) : "(root)";
  return { pkg, file: file || "—", name: node.name };
}

export interface ConcurrencyInfo {
  /** True if any concurrency marker was detected in the source slice. */
  detected: boolean;
  /** Distinct markers found (for the badge tooltip). */
  markers: string[];
}

/** Heuristic Go-concurrency markers we scan a source slice for. */
const CONCURRENCY_MARKERS: { re: RegExp; label: string }[] = [
  { re: /(^|\W)go\s+\w[\w.]*\s*\(/, label: "go " },
  { re: /(^|\W)go\s+func\s*\(/, label: "go func()" },
  { re: /<-/, label: "<- channel" },
  { re: /\bchan\b/, label: "chan" },
  { re: /\bselect\s*\{/, label: "select{}" },
  { re: /sync\.WaitGroup/, label: "sync.WaitGroup" },
  { re: /sync\.Mutex|sync\.RWMutex/, label: "sync.Mutex" },
  { re: /\.Lock\(\)|\.Unlock\(\)/, label: "Lock/Unlock" },
];

/** Detect Go concurrency in a source slice (the hop's lineRange window). */
export function detectConcurrency(sourceSlice: string | undefined | null): ConcurrencyInfo {
  if (!sourceSlice) return { detected: false, markers: [] };
  const markers: string[] = [];
  for (const m of CONCURRENCY_MARKERS) {
    if (m.re.test(sourceSlice) && !markers.includes(m.label)) markers.push(m.label);
  }
  return { detected: markers.length > 0, markers };
}

/**
 * Best-effort goroutine stitching: find named functions invoked inside `go …`
 * statements in the source slice that ALSO exist in the graph (resolved from
 * the hop's outgoing `calls` first, then by global name). Returns the matched
 * callee nodes so the UI can draw a dashed "causal" link to the goroutine body.
 * HEURISTIC: only matches simple `go Name(` / `go recv.Name(` / `go func(){ Name( }`
 * forms; it cannot follow channel sends to their receivers.
 */
export function goroutineCallees(
  graph: KnowledgeGraph,
  hopId: string,
  sourceSlice: string | undefined | null,
): GraphNode[] {
  if (!sourceSlice) return [];
  const calleeIndex = new Map<string, GraphNode>();
  // Prefer the hop's own call targets (most precise).
  for (const t of callTargets(graph, hopId)) calleeIndex.set(t.name, t);
  const globalByName = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.type === "function" && !globalByName.has(n.name)) globalByName.set(n.name, n);
  }
  const found = new Map<string, GraphNode>();
  // `go pkg.Name(` or `go Name(` — capture the final identifier before "(".
  const goCall = /(^|\W)go\s+(?:[\w]+\.)*([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = goCall.exec(sourceSlice)) !== null) {
    const name = m[2];
    if (!name || name === "func") continue;
    const node = calleeIndex.get(name) ?? globalByName.get(name);
    if (node && node.id !== hopId) found.set(node.id, node);
  }
  // `go func(){ … Name(…) … }()` — scan calls inside an inline goroutine body.
  const goFunc = /go\s+func\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\(\s*\)/g;
  while ((m = goFunc.exec(sourceSlice)) !== null) {
    const body = m[1] ?? "";
    const callRe = /(?:[\w]+\.)*([A-Za-z_]\w*)\s*\(/g;
    let c: RegExpExecArray | null;
    while ((c = callRe.exec(body)) !== null) {
      const name = c[1];
      if (!name || name === "func") continue;
      const node = calleeIndex.get(name);
      if (node && node.id !== hopId) found.set(node.id, node);
    }
  }
  return [...found.values()];
}

/**
 * Fuzzy subsequence match + score for the symbol palette. Returns a score
 * (higher is better) or -1 for no match. Rewards contiguous runs, word-start
 * hits, and an exact prefix.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t === q) return 10000;
  if (t.startsWith(q)) return 5000 - t.length;
  let score = 0;
  let qi = 0;
  let prevIdx = -1;
  let run = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let bonus = 10;
      if (prevIdx === ti - 1) {
        run++;
        bonus += run * 8; // contiguous run bonus
      } else {
        run = 0;
      }
      if (ti === 0 || /[^A-Za-z0-9]/.test(t[ti - 1])) bonus += 15; // word start
      score += bonus;
      prevIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return -1; // not all query chars matched
  return score - t.length * 0.5; // mild shorter-is-better tiebreak
}

/** Rank graph nodes by fuzzy match against a query (cap results). */
export function fuzzySearchNodes(
  nodes: GraphNode[],
  query: string,
  limit = 30,
): GraphNode[] {
  const q = query.trim();
  if (!q) {
    return nodes
      .filter((n) => n.type === "function" || n.type === "class")
      .slice(0, limit);
  }
  const scored: { n: GraphNode; s: number }[] = [];
  for (const n of nodes) {
    const s = fuzzyScore(q, n.name);
    if (s >= 0) scored.push({ n, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.n);
}

/** Subtree node-count from a node (callees direction), capped depth, cycle-safe. */
export function subtreeSize(
  graph: KnowledgeGraph,
  id: string,
  direction: TraceDirection = "callees",
  maxDepth = 6,
): number {
  const seen = new Set<string>();
  const visit = (nid: string, depth: number): void => {
    if (seen.has(nid) || depth > maxDepth) return;
    seen.add(nid);
    const next =
      direction === "callees"
        ? graph.edges.filter((e) => e.source === nid && e.type === "calls").map((e) => e.target)
        : graph.edges.filter((e) => e.target === nid && e.type === "calls").map((e) => e.source);
    for (const n of next) visit(n, depth + 1);
  };
  visit(id, 0);
  return seen.size;
}

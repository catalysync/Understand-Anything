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

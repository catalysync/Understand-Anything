// Items 185 + 186: federated search over structural nodes + domain flows/steps
// + symbols, with result-type badges, plus the best-view routing each result
// implies (a flow lands in domain; a function offers trace; a file opens
// code+structural). One module so SearchBar and the command palette agree.

import type { KnowledgeGraph, GraphNode } from "@understand-anything/core/types";
import { searchDomainGraph } from "./domainHelpers";
import type { DomainSearchHit } from "./domainHelpers";

/** The realm a hit came from — drives the badge + routing. */
export type ResultRealm = "structural" | "domain" | "step" | "symbol";

export interface FederatedResult {
  nodeId: string;
  name: string;
  /** The underlying node type (function/class/file/flow/step/domain/…). */
  nodeType: string;
  realm: ResultRealm;
  /** Short uppercase badge text. */
  badge: string;
  /** Match score (higher = better) for ranking across realms. */
  score: number;
  /** For domain hits: the domain to navigate into. */
  domainId?: string;
  /** Source file path, when known (file/step results). */
  filePath?: string;
}

/** What kind of view a result should open in. */
export type RouteKind = "trace" | "domain" | "structural" | "code";

export interface ResultRoute {
  /** Primary action. */
  primary: RouteKind;
  /** Optional secondary action (e.g. a function also opens in structural). */
  secondary?: RouteKind;
}

/**
 * Item 186: decide the best view for a result.
 *  - flow / domain        → domain
 *  - step                 → domain (its flow) — code as secondary
 *  - function / class      → trace (offer) — structural as secondary
 *  - file                 → code + structural
 *  - other structural      → structural
 */
export function routeForResult(r: FederatedResult): ResultRoute {
  if (r.realm === "domain") {
    return r.nodeType === "flow"
      ? { primary: "domain" }
      : { primary: "domain" };
  }
  if (r.realm === "step") {
    return { primary: "domain", secondary: r.filePath ? "code" : undefined };
  }
  // structural / symbol
  if (r.nodeType === "function" || r.nodeType === "class") {
    return { primary: "trace", secondary: "structural" };
  }
  if (r.nodeType === "file") {
    return { primary: "structural", secondary: "code" };
  }
  return { primary: "structural" };
}

function badgeFor(realm: ResultRealm, nodeType: string): string {
  if (realm === "domain") return nodeType === "flow" ? "FLOW" : "DOMAIN";
  if (realm === "step") return "STEP";
  return nodeType.toUpperCase();
}

/** Cheap substring-rank score (case-insensitive). */
function rankName(name: string, q: string): number {
  const lower = name.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return -1;
  // Exact > prefix > earlier-position > shorter.
  let s = 100;
  if (lower === q) s += 60;
  else if (idx === 0) s += 30;
  s -= idx;
  s -= name.length * 0.2;
  return s;
}

/**
 * Run a federated search across both graphs. `structuralResults` (already
 * scored by the SearchEngine) is optional — when given, its nodes seed the
 * structural realm; otherwise we substring-match structural names directly.
 */
export function federatedSearch(
  query: string,
  graph: KnowledgeGraph | null,
  domainGraph: KnowledgeGraph | null,
  structuralHits?: { nodeId: string; score: number }[],
  limit = 24,
): FederatedResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const out: FederatedResult[] = [];
  const seen = new Set<string>();
  const push = (r: FederatedResult) => {
    if (seen.has(r.nodeId)) return;
    seen.add(r.nodeId);
    out.push(r);
  };

  // ---- Structural / symbol realm -----------------------------------------
  if (graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
    if (structuralHits && structuralHits.length > 0) {
      for (const hit of structuralHits) {
        const node = byId.get(hit.nodeId);
        if (!node) continue;
        const isSymbol = node.type === "function" || node.type === "class";
        const realm: ResultRealm = isSymbol ? "symbol" : "structural";
        push({
          nodeId: node.id,
          name: node.name,
          nodeType: node.type,
          realm,
          badge: badgeFor(realm, node.type),
          score: (1 - hit.score) * 100,
          filePath: node.filePath ?? undefined,
        });
      }
    } else {
      for (const node of graph.nodes) {
        const s = rankName(node.name, q);
        if (s < 0) continue;
        const isSymbol = node.type === "function" || node.type === "class";
        const realm: ResultRealm = isSymbol ? "symbol" : "structural";
        push({
          nodeId: node.id,
          name: node.name,
          nodeType: node.type,
          realm,
          badge: badgeFor(realm, node.type),
          score: s,
          filePath: node.filePath ?? undefined,
        });
      }
    }
  }

  // ---- Domain realm (flows / steps / domains) ----------------------------
  if (domainGraph) {
    const hits: DomainSearchHit[] = searchDomainGraph(domainGraph, query);
    const byId = new Map(domainGraph.nodes.map((n) => [n.id, n] as const));
    for (const hit of hits) {
      if (hit.kind === "entity") continue; // entities aren't navigable nodes
      const node: GraphNode | undefined = byId.get(hit.node.id);
      if (!node) continue;
      const realm: ResultRealm = hit.kind === "step" ? "step" : "domain";
      push({
        nodeId: node.id,
        name: node.name,
        nodeType: node.type,
        realm,
        badge: badgeFor(realm, node.type),
        // Domains/flows rank a touch above raw structural noise.
        score: rankName(node.name, q) + (hit.kind === "domain" ? 20 : 10),
        domainId: hit.domainId,
        filePath: node.filePath ?? undefined,
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

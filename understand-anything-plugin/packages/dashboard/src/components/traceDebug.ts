// Wave-3 "interactive-debugging" helpers — static analogues of debugger UX.
// Pure functions over source slices + the KnowledgeGraph. No React, no store.
// EVERYTHING here is heuristic regex/structural parsing (NOT real SSA / CFG);
// each exported helper documents exactly how rough it is so the UI can label it.
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { callTargets, packageOf } from "./traceGraph";

// ---------------------------------------------------------------------------
// Feature 21 — Watch a symbol.
// ---------------------------------------------------------------------------

/**
 * Count how many times a watched symbol appears (read/write/call) in a hop's
 * source slice. Word-boundary match so `err` doesn't match `errors`. Returns 0
 * if no source or no match. HEURISTIC: pure lexical, ignores scope/shadowing.
 */
export function watchHitsInSource(symbol: string, sourceSlice: string | undefined | null): number {
  if (!sourceSlice || !symbol.trim()) return 0;
  const esc = symbol.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "g");
  const m = sourceSlice.match(re);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// Feature 22 — Jump to where it was set (best-effort static dataflow).
// ---------------------------------------------------------------------------

export interface AssignSite {
  /** 1-based absolute line in the file (sliceStart + local offset). */
  line: number;
  text: string;
  kind: "declare" | "assign" | "return";
}

/**
 * Find the LAST assignment/return of `symbol` inside a source slice. Matches
 * Go-ish `name :=`, `name =`, `name, x :=`, and `return …name`. HEURISTIC:
 * regex over text, NOT scope-aware — it's a "most-recent-write-by-text" guess,
 * not real reaching-definitions / SSA. `sliceStart` is the 1-based file line of
 * the slice's first line so we can return an absolute line number.
 */
export function findAssignmentInSlice(
  symbol: string,
  sourceSlice: string | undefined | null,
  sliceStart: number,
): AssignSite | null {
  if (!sourceSlice || !symbol.trim()) return null;
  const esc = symbol.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `name :=` or `name, other :=` (declaration), `name =` (assign).
  const declRe = new RegExp(`(^|[\\s,(])${esc}\\s*(,[^=]*)?:=`);
  const assignRe = new RegExp(`(^|[\\s,(])${esc}\\s*(,[^=]*)?=[^=]`);
  const retRe = new RegExp(`\\breturn\\b[^\\n]*\\b${esc}\\b`);
  const lines = sourceSlice.split("\n");
  let found: AssignSite | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const t = raw.trim();
    if (!t || t.startsWith("//")) continue;
    let kind: AssignSite["kind"] | null = null;
    if (declRe.test(raw)) kind = "declare";
    else if (assignRe.test(raw) && !/[!<>]=/.test(raw)) kind = "assign";
    else if (retRe.test(raw)) kind = "return";
    if (kind) found = { line: sliceStart + i, text: t, kind }; // keep last
  }
  return found;
}

// ---------------------------------------------------------------------------
// Feature 23 — Scope inspector (static).
// ---------------------------------------------------------------------------

export interface ScopeInfo {
  signature: string | null;
  params: string[];
  locals: string[];
  returns: string | null;
}

/**
 * Pragmatic parse of a Go-ish function's scope from its source slice:
 *  - signature  : first `func …(` line
 *  - params     : identifiers inside the signature's outer parens
 *  - returns    : the return clause after `)` (if any)
 *  - locals     : LHS identifiers of `x :=` declarations in the body
 * HEURISTIC: regex, single-paren-depth params, no shadowing/closure analysis.
 */
export function parseScope(sourceSlice: string | undefined | null): ScopeInfo {
  const empty: ScopeInfo = { signature: null, params: [], locals: [], returns: null };
  if (!sourceSlice) return empty;
  const lines = sourceSlice.split("\n");
  // Find the signature line (first non-comment line containing `func`).
  let sigLine = lines.find((l) => /\bfunc\b/.test(l) && l.includes("(")) ?? null;
  if (sigLine) sigLine = sigLine.trim().replace(/\s*\{\s*$/, "");

  const params: string[] = [];
  let returns: string | null = null;
  if (sigLine) {
    // func (recv T) Name(p1 T1, p2 T2) (r1, r2) {  → capture first (...) group.
    const afterName = sigLine.replace(/^func\s*(\([^)]*\)\s*)?[A-Za-z0-9_]*\s*/, "");
    const open = afterName.indexOf("(");
    if (open >= 0) {
      // Match the balanced paren span for params.
      let depth = 0;
      let end = -1;
      for (let i = open; i < afterName.length; i++) {
        const c = afterName[i];
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end > open) {
        const inner = afterName.slice(open + 1, end).trim();
        if (inner) {
          for (const part of inner.split(",")) {
            const tok = part.trim().split(/\s+/)[0];
            if (tok && /^[A-Za-z_]\w*$/.test(tok)) params.push(tok);
          }
        }
        const tail = afterName.slice(end + 1).trim();
        if (tail) returns = tail.replace(/\s*\{?\s*$/, "").trim() || null;
      }
    }
  }

  // Locals: LHS of `x :=` and `var x` declarations in the body.
  const locals: string[] = [];
  const seen = new Set<string>(params);
  const declRe = /(^|[\s])([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:=/;
  const varRe = /(^|[\s])var\s+([A-Za-z_]\w*)/;
  for (const raw of lines) {
    if (raw === undefined) continue;
    const t = raw.trim();
    if (t.startsWith("//")) continue;
    const dm = declRe.exec(raw);
    if (dm) {
      for (const id of dm[2].split(",").map((s) => s.trim())) {
        if (id && id !== "_" && /^[A-Za-z_]\w*$/.test(id) && !seen.has(id)) {
          seen.add(id);
          locals.push(id);
        }
      }
    }
    const vm = varRe.exec(raw);
    if (vm && vm[2] !== "_" && !seen.has(vm[2])) {
      seen.add(vm[2]);
      locals.push(vm[2]);
    }
  }

  return { signature: sigLine, params, returns, locals };
}

// ---------------------------------------------------------------------------
// Feature 26 — Conditional highlight (predicate bar).
// ---------------------------------------------------------------------------

export type PredicateKind = "returns-error" | "package" | "calls" | "name" | "complexity" | "";

export interface Predicate {
  kind: PredicateKind;
  /** Raw argument (regex for name, pkg substring, callee name, complexity). */
  arg: string;
}

/** Parse a predicate string like `returns error`, `package:X`, `calls:Y`,
 *  `name:~regex`, `complexity:complex` into a structured predicate. */
export function parsePredicate(input: string): Predicate {
  const s = input.trim();
  if (!s) return { kind: "", arg: "" };
  const low = s.toLowerCase();
  if (/^returns?\s*err/.test(low) || low === "returns error") return { kind: "returns-error", arg: "" };
  const colon = s.indexOf(":");
  if (colon >= 0) {
    const head = s.slice(0, colon).trim().toLowerCase();
    let arg = s.slice(colon + 1).trim();
    if (head === "package" || head === "pkg") return { kind: "package", arg };
    if (head === "calls" || head === "call") return { kind: "calls", arg };
    if (head === "name") {
      if (arg.startsWith("~")) arg = arg.slice(1).trim();
      return { kind: "name", arg };
    }
    if (head === "complexity" || head === "cx") return { kind: "complexity", arg: arg.toLowerCase() };
  }
  // Bare word → name regex.
  return { kind: "name", arg: s };
}

/** Test whether a hop matches a parsed predicate. errorInfo lets `returns-error`
 *  reuse the same detection as feature 27. */
export function hopMatchesPredicate(
  pred: Predicate,
  node: GraphNode,
  graph: KnowledgeGraph,
  isError: boolean,
): boolean {
  switch (pred.kind) {
    case "returns-error":
      return isError;
    case "package":
      return !pred.arg || packageOf(node).toLowerCase().includes(pred.arg.toLowerCase());
    case "calls": {
      if (!pred.arg) return false;
      const a = pred.arg.toLowerCase();
      return callTargets(graph, node.id).some((t) => t.name.toLowerCase().includes(a));
    }
    case "name": {
      if (!pred.arg) return false;
      try {
        return new RegExp(pred.arg, "i").test(node.name);
      } catch {
        return node.name.toLowerCase().includes(pred.arg.toLowerCase());
      }
    }
    case "complexity":
      return node.complexity === pred.arg;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Feature 27 — Error-path tracing.
// ---------------------------------------------------------------------------

const ERROR_MARKERS: { re: RegExp; label: string }[] = [
  { re: /\bif\s+err\s*!=\s*nil\b/, label: "if err != nil" },
  { re: /\breturn\b[^\n]*\berr\b/, label: "return …err" },
  { re: /\berrors\.(Wrap|Wrapf|New|Errorf)\b/, label: "errors.Wrap/New" },
  { re: /\bfmt\.Errorf\b/, label: "fmt.Errorf" },
  { re: /\berrs\.Wrap\b/, label: "errs.Wrap" },
  { re: /\bmarkFailed\b/, label: "markFailed" },
  { re: /\b\w*[Ff]ail(ed)?\s*\(/, label: "fail(...)" },
  { re: /\bpanic\s*\(/, label: "panic(" },
];

export interface ErrorInfo {
  isError: boolean;
  markers: string[];
}

/** Detect error-handling in a source slice (Go-ish). HEURISTIC: pure lexical. */
export function detectErrorHandling(sourceSlice: string | undefined | null): ErrorInfo {
  if (!sourceSlice) return { isError: false, markers: [] };
  const markers: string[] = [];
  for (const m of ERROR_MARKERS) {
    if (m.re.test(sourceSlice) && !markers.includes(m.label)) markers.push(m.label);
  }
  return { isError: markers.length > 0, markers };
}

/** Fallback when no source: scan name/summary/tags for error-ish keywords. */
export function looksLikeErrorNode(node: GraphNode): boolean {
  const hay = `${node.name} ${node.summary ?? ""} ${(node.tags ?? []).join(" ")}`.toLowerCase();
  return /\berror|\bfail|\bpanic|\brecover|\bfault\b/.test(hay);
}

// ---------------------------------------------------------------------------
// Feature 28 — Complexity heat overlay.
// ---------------------------------------------------------------------------

/** A 0..1 heat value for a hop. Prefers `complexity`; falls back to LOC from
 *  lineRange (capped) blended with fan-in. */
export function heatValue(node: GraphNode, fanIn: number): number {
  const byComplexity: Record<string, number> = { simple: 0.18, moderate: 0.55, complex: 0.92 };
  if (node.complexity && byComplexity[node.complexity] !== undefined) {
    return byComplexity[node.complexity];
  }
  const loc = node.lineRange ? node.lineRange[1] - node.lineRange[0] + 1 : 0;
  const locScore = Math.min(1, loc / 120);
  const fanScore = Math.min(1, fanIn / 12);
  return Math.min(1, 0.6 * locScore + 0.4 * fanScore);
}

/** Map a 0..1 heat value to a green→amber→red rgb() string. */
export function heatColor(v: number): string {
  const c = Math.max(0, Math.min(1, v));
  // green (74,222,128) → amber (251,191,36) → red (248,113,113)
  let r: number, g: number, b: number;
  if (c < 0.5) {
    const t = c / 0.5;
    r = Math.round(74 + (251 - 74) * t);
    g = Math.round(222 + (191 - 222) * t);
    b = Math.round(128 + (36 - 128) * t);
  } else {
    const t = (c - 0.5) / 0.5;
    r = Math.round(251 + (248 - 251) * t);
    g = Math.round(191 + (113 - 191) * t);
    b = Math.round(36 + (113 - 36) * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

// ---------------------------------------------------------------------------
// Feature 29 — Control-flow mini-diagram (structural outline).
// ---------------------------------------------------------------------------

export interface CFNode {
  depth: number;
  kind: string;
  text: string;
  line: number;
}

const CF_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /^\}?\s*else\s+if\b/, kind: "else if" },
  { re: /^\}?\s*else\b/, kind: "else" },
  { re: /^if\b/, kind: "if" },
  { re: /^for\b/, kind: "for" },
  { re: /^switch\b/, kind: "switch" },
  { re: /^select\b/, kind: "select" },
  { re: /^case\b/, kind: "case" },
  { re: /^defer\b/, kind: "defer" },
  { re: /^go\b/, kind: "go" },
  { re: /^return\b/, kind: "return" },
];

/**
 * Best-effort NESTED OUTLINE of control structures in a function body, indented
 * by literal brace depth. Tracks `{`/`}` to compute nesting. HEURISTIC: brace
 * counting ignores braces inside strings/comments, so deep/odd code can be off
 * by a level — it is a STRUCTURAL OUTLINE, not a real control-flow graph.
 * sliceStart is the 1-based file line of the slice's first line.
 */
export function controlFlowOutline(
  sourceSlice: string | undefined | null,
  sliceStart: number,
  maxNodes = 60,
): CFNode[] {
  if (!sourceSlice) return [];
  const lines = sourceSlice.split("\n");
  const out: CFNode[] = [];
  let depth = 0;
  for (let i = 0; i < lines.length && out.length < maxNodes; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const t = raw.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
      // still adjust depth for any braces on a comment line (rare)
    }
    // The opening depth for THIS line is the current depth before its own braces.
    const opensBefore = depth;
    for (const p of CF_PATTERNS) {
      if (p.re.test(t)) {
        out.push({
          depth: opensBefore,
          kind: p.kind,
          text: t.replace(/\s*\{\s*$/, "").slice(0, 80),
          line: sliceStart + i,
        });
        break;
      }
    }
    // Update brace depth after recording (so the line's body nests one deeper).
    for (const ch of t) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  // Normalize so the shallowest recorded node sits at depth 0.
  const min = out.reduce((m, n) => Math.min(m, n.depth), Infinity);
  if (Number.isFinite(min) && min > 0) for (const n of out) n.depth -= min;
  return out;
}

// ---------------------------------------------------------------------------
// Feature 30 — Trace diff (in-app capture-to-capture).
// ---------------------------------------------------------------------------

export type DiffStatus = "same" | "added" | "removed" | "moved";

/**
 * Diff the CURRENT ordered hop ids against a saved snapshot's ordered ids.
 *  - added   : present now, absent in snapshot
 *  - removed : present in snapshot, absent now (returned separately)
 *  - moved   : present in both but at a different index
 *  - same    : present in both at the same index
 * This is an IN-APP capture-to-capture diff (no git). A true commit-to-commit
 * diff would need a server endpoint to re-analyze an older commit.
 */
export function diffTraceIds(
  currentIds: string[],
  snapshotIds: string[],
): { statusById: Map<string, DiffStatus>; removed: string[] } {
  const snapIndex = new Map<string, number>();
  snapshotIds.forEach((id, i) => snapIndex.set(id, i));
  const curSet = new Set(currentIds);
  const statusById = new Map<string, DiffStatus>();
  currentIds.forEach((id, i) => {
    if (!snapIndex.has(id)) statusById.set(id, "added");
    else if (snapIndex.get(id) !== i) statusById.set(id, "moved");
    else statusById.set(id, "same");
  });
  const removed = snapshotIds.filter((id) => !curSet.has(id));
  return { statusById, removed };
}

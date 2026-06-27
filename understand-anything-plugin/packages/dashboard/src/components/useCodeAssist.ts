import { useCallback, useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

/**
 * Shared helpers for the code-assist features used by CodeViewer and
 * TraceView: line explanation (via /explain.json → claude -p) and
 * goto-definition (resolve an identifier token to a graph node).
 *
 * Wave-4 extends this to a full "converse with Claude" client:
 *  - mode-aware calls (explain | followup | quiz | walkthrough | subtree | ghost)
 *  - rules / context / level / goDocs decoration sent on every call
 *  - parsing the fenced ```json affordance tail (suggested_questions, citations,
 *    confidence, clarifying_question) so the UI can render chips/links.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Parsed affordances for an assistant turn (chips/citations live here). */
  affordances?: Affordances;
}

export interface Citation {
  file: string;
  line: number;
}

export interface Affordances {
  suggestedQuestions: string[];
  citations: Citation[];
  confidence: number | null;
  clarifyingQuestion: string;
}

/** Per-call extra context sent to the endpoint (rules/level/goDocs/@-mentions). */
export interface ExplainOpts {
  rules?: string;
  level?: string;
  goDocs?: boolean;
  context?: string;
}

const EMPTY_AFFORDANCES: Affordances = {
  suggestedQuestions: [],
  citations: [],
  confidence: null,
  clarifyingQuestion: "",
};

/**
 * Split an answer into the human-readable prose and the parsed affordance tail.
 * The tail is a fenced ```json block the model is asked to append; parsing is
 * best-effort — if it's missing or malformed we just show the whole text and
 * return empty affordances (so the UI degrades gracefully).
 */
export function parseAnswer(raw: string): { prose: string; affordances: Affordances } {
  if (!raw) return { prose: "", affordances: { ...EMPTY_AFFORDANCES } };
  // Find the LAST fenced json block (the affordance tail is appended last).
  const fence = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let last: { start: number; body: string } | null = null;
  while ((match = fence.exec(raw)) !== null) {
    last = { start: match.index, body: match[1] };
  }
  if (!last) return { prose: raw.trim(), affordances: { ...EMPTY_AFFORDANCES } };

  let aff: Affordances = { ...EMPTY_AFFORDANCES };
  try {
    const obj = JSON.parse(last.body.trim()) as Record<string, unknown>;
    // Only treat it as the affordance tail if it has at least one known key.
    const looksLikeTail =
      "suggested_questions" in obj ||
      "citations" in obj ||
      "confidence" in obj ||
      "clarifying_question" in obj;
    if (!looksLikeTail) return { prose: raw.trim(), affordances: { ...EMPTY_AFFORDANCES } };

    const sq = Array.isArray(obj.suggested_questions) ? obj.suggested_questions : [];
    const ci = Array.isArray(obj.citations) ? obj.citations : [];
    aff = {
      suggestedQuestions: sq
        .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        .map((q) => q.trim())
        .slice(0, 6),
      citations: ci
        .map((c) => {
          if (!c || typeof c !== "object") return null;
          const file = (c as Record<string, unknown>).file;
          const line = Number((c as Record<string, unknown>).line);
          if (typeof file !== "string" || !file.trim() || !Number.isFinite(line)) return null;
          return { file: file.trim(), line: Math.max(1, Math.floor(line)) } as Citation;
        })
        .filter((c): c is Citation => c !== null)
        .slice(0, 12),
      confidence:
        typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
          ? Math.max(0, Math.min(1, obj.confidence))
          : null,
      clarifyingQuestion:
        typeof obj.clarifying_question === "string" ? obj.clarifying_question.trim() : "",
    };
  } catch {
    // Malformed tail — drop it but still strip the fenced block from the prose.
    return { prose: raw.slice(0, last.start).trim() || raw.trim(), affordances: { ...EMPTY_AFFORDANCES } };
  }

  const prose = raw.slice(0, last.start).trim();
  return { prose: prose || raw.trim(), affordances: aff };
}

export interface ExplainState {
  status: "idle" | "loading" | "loaded" | "error";
  explanation: string | null;
  error: string | null;
  // 1-based line the explanation is anchored to (for the popover position).
  line: number | null;
  // Grounded claude session for follow-up Q&A.
  sessionId: string | null;
  // Follow-up Q&A thread (excludes the initial explanation).
  thread: ChatTurn[];
  // True while a follow-up question is in flight.
  followUpLoading: boolean;
  // Affordances parsed from the most recent answer (initial or latest follow-up).
  affordances: Affordances;
  // The mode the panel was opened in (so the UI can adapt, e.g. quiz/walkthrough).
  mode: ExplainMode;
}

export type ExplainMode =
  | "explain"
  | "quiz"
  | "walkthrough"
  | "subtree"
  | "confidence";

const IDLE: ExplainState = {
  status: "idle",
  explanation: null,
  error: null,
  line: null,
  sessionId: null,
  thread: [],
  followUpLoading: false,
  affordances: { ...EMPTY_AFFORDANCES },
  mode: "explain",
};

/**
 * @param nodeId  when provided, the returned session_id is persisted to the
 *   workspace (node→session map) and an existing stored session is resumed so
 *   the conversation survives dashboard restarts.
 */
export function useExplain(accessToken: string, nodeId?: string | null) {
  const [state, setState] = useState<ExplainState>(IDLE);
  const setNodeSession = useDashboardStore((s) => s.setNodeSession);
  const getNodeSession = useDashboardStore((s) => s.getNodeSession);

  const explain = useCallback(
    (filePath: string, start: number, end: number, anchorLine: number, opts?: ExplainOpts) => {
      if (accessToken === "__demo__") {
        setState({
          ...IDLE,
          status: "error",
          error: "Explanations require the local dashboard server.",
          line: anchorLine,
        });
        return;
      }

      // If this node already has a persisted claude session, resume that
      // conversation instead of starting fresh — survives restarts.
      const existing = nodeId ? getNodeSession(nodeId) : undefined;
      if (existing) {
        setState({ ...IDLE, status: "loading", line: anchorLine, sessionId: existing });
        fetch("/explain.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: accessToken,
            sessionId: existing,
            mode: "followup",
            ...opts,
            question:
              "Briefly re-summarize (2-3 sentences) what this code does so I can continue asking, markdown.",
          }),
        })
          .then(async (res) => {
            const data = (await res.json()) as { result?: string; session_id?: string | null; error?: string };
            if (!res.ok || !data.result) throw new Error(data.error || "Failed to resume session");
            if (nodeId && data.session_id) setNodeSession(nodeId, data.session_id);
            const { prose, affordances } = parseAnswer(data.result);
            setState({
              ...IDLE,
              status: "loaded",
              explanation: `_(Resumed your earlier conversation about this code.)_\n\n${prose}`,
              line: anchorLine,
              sessionId: data.session_id ?? existing,
              affordances,
            });
          })
          .catch((err: unknown) => {
            setState({ ...IDLE, status: "error", error: err instanceof Error ? err.message : String(err), line: anchorLine });
          });
        return;
      }

      setState({ ...IDLE, status: "loading", line: anchorLine });
      fetch("/explain.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: accessToken, path: filePath, start, end, ...opts }),
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            explanation?: string;
            session_id?: string | null;
            error?: string;
          };
          if (!res.ok || !data.explanation) {
            throw new Error(data.error || "Failed to get explanation");
          }
          if (nodeId && data.session_id) setNodeSession(nodeId, data.session_id);
          const { prose, affordances } = parseAnswer(data.explanation);
          setState({
            ...IDLE,
            status: "loaded",
            explanation: prose,
            line: anchorLine,
            sessionId: data.session_id ?? null,
            affordances,
          });
        })
        .catch((err: unknown) => {
          setState({
            ...IDLE,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            line: anchorLine,
          });
        });
    },
    [accessToken, nodeId, getNodeSession, setNodeSession],
  );

  /**
   * Run a non-line mode (quiz / walkthrough / subtree) that produces a fresh
   * answer + session. `payload` carries mode-specific fields (path/start/end or
   * context) plus rules/level/goDocs decoration.
   */
  const runMode = useCallback(
    (mode: ExplainMode, payload: Record<string, unknown>, anchorLine = 1) => {
      if (accessToken === "__demo__") {
        setState({ ...IDLE, status: "error", error: "Explanations require the local dashboard server." });
        return;
      }
      setState({ ...IDLE, status: "loading", line: anchorLine, mode });
      fetch("/explain.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: accessToken, mode, ...payload }),
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            explanation?: string;
            session_id?: string | null;
            error?: string;
          };
          if (!res.ok || !data.explanation) throw new Error(data.error || "Failed");
          if (nodeId && data.session_id) setNodeSession(nodeId, data.session_id);
          const { prose, affordances } = parseAnswer(data.explanation);
          setState({
            ...IDLE,
            status: "loaded",
            explanation: prose,
            line: anchorLine,
            sessionId: data.session_id ?? null,
            affordances,
            mode,
          });
        })
        .catch((err: unknown) => {
          setState({ ...IDLE, status: "error", error: err instanceof Error ? err.message : String(err), mode });
        });
    },
    [accessToken, nodeId, setNodeSession],
  );

  const askFollowUp = useCallback(
    (question: string, opts?: ExplainOpts) => {
      const q = question.trim();
      setState((prev) => {
        if (!prev.sessionId || prev.followUpLoading || !q) return prev;
        const prevMode = prev.mode;
        // Optimistically append the user turn + mark loading.
        const next: ExplainState = {
          ...prev,
          followUpLoading: true,
          thread: [...prev.thread, { role: "user", text: q }],
        };
        // Quiz grading turns reuse mode:quiz so the server grades the answer.
        const mode = prevMode === "quiz" ? "quiz" : "followup";
        fetch("/explain.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: accessToken, sessionId: prev.sessionId, mode, ...opts, question: q }),
        })
          .then(async (res) => {
            const data = (await res.json()) as {
              result?: string;
              session_id?: string | null;
              error?: string;
            };
            if (!res.ok || !data.result) throw new Error(data.error || "Follow-up failed");
            if (nodeId && data.session_id) setNodeSession(nodeId, data.session_id);
            const { prose, affordances } = parseAnswer(data.result);
            setState((s) => ({
              ...s,
              followUpLoading: false,
              // Refresh sessionId (resume returns a new id each turn).
              sessionId: data.session_id ?? s.sessionId,
              thread: [...s.thread, { role: "assistant", text: prose, affordances }],
              affordances,
            }));
          })
          .catch((err: unknown) => {
            setState((s) => ({
              ...s,
              followUpLoading: false,
              thread: [
                ...s.thread,
                { role: "assistant", text: `⚠️ ${err instanceof Error ? err.message : String(err)}` },
              ],
            }));
          });
        return next;
      });
    },
    [accessToken, nodeId, setNodeSession],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { state, explain, runMode, askFollowUp, reset };
}

/**
 * Lightweight one-shot client for ghost (one-sentence) explanations. Returns a
 * fetcher that resolves to a single sentence (or null on failure). Used by the
 * debounced hover tooltip; the server caches per file:lineRange.
 */
export function fetchGhost(
  accessToken: string,
  filePath: string,
  start: number,
  end: number,
): Promise<string | null> {
  if (accessToken === "__demo__") return Promise.resolve(null);
  return fetch("/explain.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: accessToken, mode: "ghost", path: filePath, start, end }),
  })
    .then(async (res) => {
      const data = (await res.json()) as { explanation?: string };
      return data.explanation?.trim() || null;
    })
    .catch(() => null);
}

/**
 * Resolve an identifier token (a likely function/class name) to a target
 * graph node id. Prefers the current node's outgoing `calls` edges by target
 * name; falls back to any function/class node whose name matches the token.
 * Returns null if unresolved (callers should no-op / not underline).
 */
export function resolveSymbol(
  graph: KnowledgeGraph,
  token: string,
  currentNodeId: string | null,
): string | null {
  const name = token.trim();
  if (!name) return null;
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  if (currentNodeId) {
    const callTarget = graph.edges
      .filter((e) => e.source === currentNodeId && e.type === "calls")
      .map((e) => nodesById.get(e.target))
      .find((n): n is GraphNode => n !== undefined && n.name === name);
    if (callTarget) return callTarget.id;
  }

  const byName = graph.nodes.find(
    (n) => (n.type === "function" || n.type === "class") && n.name === name,
  );
  return byName ? byName.id : null;
}

/**
 * Resolve a citation (file + line) to a graph node id: prefer a node whose
 * filePath matches and whose lineRange contains the line; else the first node
 * in that file. Returns null if no node in that file is in the graph.
 */
export function resolveCitation(
  graph: KnowledgeGraph,
  file: string,
  line: number,
): string | null {
  const norm = (p: string) => p.replace(/^\.?\//, "").trim();
  const target = norm(file);
  const inFile = graph.nodes.filter(
    (n) => n.filePath && (norm(n.filePath) === target || norm(n.filePath).endsWith("/" + target) || target.endsWith("/" + norm(n.filePath))),
  );
  if (inFile.length === 0) return null;
  const containing = inFile.find(
    (n) => n.lineRange && line >= n.lineRange[0] && line <= n.lineRange[1],
  );
  return (containing ?? inFile[0]).id;
}

/**
 * Build a set of identifier names that are resolvable jump targets from the
 * current node, so we can cheaply decide whether to underline a token.
 */
export function useResolvableNames(
  graph: KnowledgeGraph | null,
  currentNodeId: string | null,
): Set<string> {
  return useMemo(() => {
    const names = new Set<string>();
    if (!graph) return names;
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    if (currentNodeId) {
      for (const e of graph.edges) {
        if (e.source === currentNodeId && e.type === "calls") {
          const t = nodesById.get(e.target);
          if (t?.name) names.add(t.name);
        }
      }
    }
    for (const n of graph.nodes) {
      if ((n.type === "function" || n.type === "class") && n.name) names.add(n.name);
    }
    return names;
  }, [graph, currentNodeId]);
}

/** Identifier-ish token test (so we don't underline punctuation/keywords). */
export function isIdentifierToken(content: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(content.trim());
}

/** Wave-4 feature 33: slash verbs → templated questions. */
export const SLASH_VERBS: Record<string, string> = {
  "/explain": "Explain this code again, more thoroughly.",
  "/why-called": "Why and from where is this called? What triggers it in the flow?",
  "/data-flow": "Trace the data flow through this code: what comes in, how it's transformed, what goes out.",
  "/go-idiom": "What Go idiom(s) does this use, and why is that idiomatic here?",
  "/simpler": "Explain that again but simpler, for a beginner.",
  "/deeper": "Go deeper — the underlying mechanism, edge cases, and design intent.",
};

/**
 * Expand a slash verb at the start of the input to its templated question.
 * Returns the expanded question (verb replaced by template, trailing text kept)
 * or the original text if no known verb is present.
 */
export function expandSlashVerb(input: string): { expanded: string; verb: string | null } {
  const trimmed = input.trim();
  const m = /^(\/[a-z-]+)(\s+([\s\S]*))?$/i.exec(trimmed);
  if (!m) return { expanded: trimmed, verb: null };
  const verb = m[1].toLowerCase();
  const template = SLASH_VERBS[verb];
  if (!template) return { expanded: trimmed, verb: null };
  const rest = (m[3] ?? "").trim();
  return { expanded: rest ? `${template} (Specifically: ${rest})` : template, verb };
}

export { useDashboardStore };

import { useCallback, useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

/**
 * Shared helpers for the code-assist features used by CodeViewer and
 * TraceView: line explanation (via /explain.json → claude -p) and
 * goto-definition (resolve an identifier token to a graph node).
 */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
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
}

const IDLE: ExplainState = {
  status: "idle",
  explanation: null,
  error: null,
  line: null,
  sessionId: null,
  thread: [],
  followUpLoading: false,
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
    (filePath: string, start: number, end: number, anchorLine: number) => {
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
            question:
              "Briefly re-summarize (2-3 sentences) what this code does so I can continue asking, beginner-friendly, markdown.",
          }),
        })
          .then(async (res) => {
            const data = (await res.json()) as { result?: string; session_id?: string | null; error?: string };
            if (!res.ok || !data.result) throw new Error(data.error || "Failed to resume session");
            if (nodeId && data.session_id) setNodeSession(nodeId, data.session_id);
            setState({
              ...IDLE,
              status: "loaded",
              explanation: `_(Resumed your earlier conversation about this code.)_\n\n${data.result}`,
              line: anchorLine,
              sessionId: data.session_id ?? existing,
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
        body: JSON.stringify({ token: accessToken, path: filePath, start, end }),
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
          setState({
            ...IDLE,
            status: "loaded",
            explanation: data.explanation,
            line: anchorLine,
            sessionId: data.session_id ?? null,
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

  const askFollowUp = useCallback(
    (question: string) => {
      const q = question.trim();
      setState((prev) => {
        if (!prev.sessionId || prev.followUpLoading || !q) return prev;
        // Optimistically append the user turn + mark loading.
        const next: ExplainState = {
          ...prev,
          followUpLoading: true,
          thread: [...prev.thread, { role: "user", text: q }],
        };
        fetch("/explain.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: accessToken, sessionId: prev.sessionId, question: q }),
        })
          .then(async (res) => {
            const data = (await res.json()) as {
              result?: string;
              session_id?: string | null;
              error?: string;
            };
            if (!res.ok || !data.result) throw new Error(data.error || "Follow-up failed");
            if (nodeId && data.session_id) setNodeSession(nodeId, data.session_id);
            setState((s) => ({
              ...s,
              followUpLoading: false,
              // Refresh sessionId (resume returns a new id each turn).
              sessionId: data.session_id ?? s.sessionId,
              thread: [...s.thread, { role: "assistant", text: data.result! }],
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

  return { state, explain, askFollowUp, reset };
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

export { useDashboardStore };

import { useMemo, useRef, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { useTheme, zedLightPrism } from "../themes";
import {
  useExplain,
  resolveSymbol,
  useResolvableNames,
  isIdentifierToken,
} from "./useCodeAssist";
import ExplainPanel from "./ExplainPanel";
import HoverPopover, { type HoverTarget } from "./HoverPopover";
import { signatureFromSource } from "./traceGraph";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

interface CodeBlockProps {
  code: string;
  language: string;
  accessToken: string;
  filePath?: string;
  /** Highlighted range (the focus node's lineRange), 1-based inclusive. */
  highlightedRange?: { start: number; end: number } | null;
  /** Only render lines within [windowStart, windowEnd] (1-based). Optional. */
  windowStart?: number;
  windowEnd?: number;
  /** Graph + current node id power goto-definition. */
  graph?: KnowledgeGraph | null;
  currentNodeId?: string | null;
  /** Navigate to a resolved symbol's node. */
  onJumpToNode?: (nodeId: string) => void;
  /** Peek a resolved symbol's definition inline (feature 16) instead of navigating. */
  onPeekNode?: (nodeId: string) => void;
  /** Show faint ghost inlay hints (callee one-line signature) at call sites. */
  inlayHints?: boolean;
  fontSizeClass?: string;
}

/**
 * Shared highlighted code renderer with:
 *  - theme-aware syntax colors (Ayu Light on light presets, vsDark on dark)
 *  - per-line "✦ explain" affordance → /explain.json (claude -p) popover
 *  - goto-definition: clickable identifier tokens that resolve to graph nodes
 *    (Wave-2: obvious hover-underline + cursor-pointer + "↦ definition" tooltip,
 *     hover popover card, optional inline peek, and inlay signature hints)
 */
export default function CodeBlock({
  code,
  language,
  accessToken,
  filePath,
  highlightedRange = null,
  windowStart,
  windowEnd,
  graph = null,
  currentNodeId = null,
  onJumpToNode,
  onPeekNode,
  inlayHints = false,
  fontSizeClass = "text-[11px] leading-5",
}: CodeBlockProps) {
  const { preset } = useTheme();
  const prismTheme = preset.isDark ? themes.vsDark : zedLightPrism;
  const { state, explain, askFollowUp, reset } = useExplain(accessToken, currentNodeId);
  const resolvable = useResolvableNames(graph, currentNodeId);

  // Hover popover state (debounced open/close).
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );

  const clearTimers = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const scheduleHover = (token: string, e: React.MouseEvent) => {
    if (!graph) return;
    const targetId = resolveSymbol(graph, token, currentNodeId);
    if (!targetId) return;
    const node = nodesById.get(targetId);
    if (!node) return;
    const x = e.clientX;
    const y = e.clientY;
    clearTimers();
    hoverTimer.current = window.setTimeout(() => {
      setHover({ node, x, y, source: code });
    }, 350);
  };

  const scheduleClose = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(null), 220);
  };

  const onExplainLine = (lineNumber: number) => {
    if (!filePath) return;
    const start = Math.max(1, lineNumber - 1);
    const end = lineNumber + 1;
    explain(filePath, start, end, lineNumber);
  };

  const onTokenClick = (token: string) => {
    if (!graph) return;
    const targetId = resolveSymbol(graph, token, currentNodeId);
    if (!targetId) return;
    if (onPeekNode) onPeekNode(targetId);
    else if (onJumpToNode) onJumpToNode(targetId);
  };

  // Inlay hint: callee one-line signature for a resolvable token at a call site.
  const inlayFor = (token: string): string | null => {
    if (!inlayHints || !graph) return null;
    const targetId = resolveSymbol(graph, token, currentNodeId);
    if (!targetId || targetId === currentNodeId) return null;
    const node = nodesById.get(targetId);
    if (!node || node.type !== "function") return null;
    const sig = signatureFromSource(code, node);
    if (!sig) return null;
    // Compact: strip the leading "func " for an unobtrusive ghost hint.
    return sig.replace(/^func\s+/, "").slice(0, 80);
  };

  return (
    <>
      <Highlight code={code} language={language} theme={prismTheme}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => {
          const start = windowStart ?? 1;
          const end = windowEnd ?? tokens.length;
          return (
            <pre
              className={`${className} min-w-max p-0 m-0 ${fontSizeClass} font-mono`}
              style={{ ...style, background: "transparent" }}
            >
              {tokens.map((line, index) => {
                const lineNumber = index + 1;
                if (lineNumber < start || lineNumber > end) return null;
                const isHighlighted =
                  highlightedRange !== null &&
                  lineNumber >= highlightedRange.start &&
                  lineNumber <= highlightedRange.end;
                const lineProps = getLineProps({ line });
                const showPanel = state.line === lineNumber && state.status !== "idle";
                // Compute one inlay hint per line (first resolvable call token).
                let lineHint: string | null = null;
                if (inlayHints) {
                  for (const tk of line) {
                    if (isIdentifierToken(tk.content) && resolvable.has(tk.content.trim())) {
                      const h = inlayFor(tk.content);
                      if (h) {
                        lineHint = h;
                        break;
                      }
                    }
                  }
                }
                return (
                  <div key={lineNumber}>
                    <div
                      {...lineProps}
                      className={`${lineProps.className} group flex ${
                        isHighlighted ? "bg-accent/15" : "hover:bg-elevated/40"
                      }`}
                    >
                      <span className="w-12 shrink-0 select-none border-r border-border-subtle pr-3 text-right text-text-muted bg-surface/60">
                        {lineNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          showPanel && state.status !== "loading"
                            ? reset()
                            : onExplainLine(lineNumber)
                        }
                        title="Explain this line (Go-teaching)"
                        className="w-5 shrink-0 select-none text-center text-accent/0 group-hover:text-accent/70 hover:!text-accent transition-colors"
                      >
                        ✦
                      </button>
                      <span className="pl-1 pr-6 whitespace-pre">
                        {line.map((token, key) => {
                          const tokenProps = getTokenProps({ token });
                          const canJump =
                            isIdentifierToken(token.content) &&
                            resolvable.has(token.content.trim());
                          if (canJump) {
                            return (
                              <span
                                key={key}
                                {...tokenProps}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTokenClick(token.content);
                                }}
                                onMouseEnter={(e) => scheduleHover(token.content, e)}
                                onMouseLeave={scheduleClose}
                                className={`${tokenProps.className ?? ""} cursor-pointer underline decoration-dotted decoration-accent/40 underline-offset-2 hover:decoration-solid hover:decoration-accent`}
                                style={{ ...tokenProps.style }}
                                title={`↦ definition: ${token.content.trim()}`}
                              />
                            );
                          }
                          return <span key={key} {...tokenProps} />;
                        })}
                        {lineHint && (
                          <span
                            className="ml-3 italic text-text-muted/60 select-none"
                            title="Inlay hint: callee signature (heuristic)"
                          >
                            ⟹ {lineHint}
                          </span>
                        )}
                      </span>
                    </div>
                    {showPanel && (
                      <div className="flex">
                        <span className="w-12 shrink-0 border-r border-border-subtle bg-surface/60" />
                        <div className="flex-1 my-1 mr-4 ml-2">
                          <ExplainPanel
                            state={state}
                            title={`✦ Go explanation · line ${lineNumber}`}
                            onClose={reset}
                            onAsk={askFollowUp}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </pre>
          );
        }}
      </Highlight>
      {hover && (
        <div
          onMouseEnter={() => {
            if (closeTimer.current) window.clearTimeout(closeTimer.current);
          }}
        >
          <HoverPopover target={hover} onClose={() => setHover(null)} />
        </div>
      )}
    </>
  );
}

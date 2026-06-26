import { Highlight, themes } from "prism-react-renderer";
import { useTheme, zedLightPrism } from "../themes";
import {
  useExplain,
  resolveSymbol,
  useResolvableNames,
  isIdentifierToken,
} from "./useCodeAssist";
import ExplainPanel from "./ExplainPanel";
import type { KnowledgeGraph } from "@understand-anything/core/types";

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
  fontSizeClass?: string;
}

/**
 * Shared highlighted code renderer with:
 *  - theme-aware syntax colors (Ayu Light on light presets, vsDark on dark)
 *  - per-line "✦ explain" affordance → /explain.json (claude -p) popover
 *  - goto-definition: clickable identifier tokens that resolve to graph nodes
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
  fontSizeClass = "text-[11px] leading-5",
}: CodeBlockProps) {
  const { preset } = useTheme();
  const prismTheme = preset.isDark ? themes.vsDark : zedLightPrism;
  const { state, explain, askFollowUp, reset } = useExplain(accessToken, currentNodeId);
  const resolvable = useResolvableNames(graph, currentNodeId);

  const onExplainLine = (lineNumber: number) => {
    if (!filePath) return;
    const start = Math.max(1, lineNumber - 1);
    const end = lineNumber + 1;
    explain(filePath, start, end, lineNumber);
  };

  const onTokenClick = (token: string) => {
    if (!graph || !onJumpToNode) return;
    const targetId = resolveSymbol(graph, token, currentNodeId);
    if (targetId) onJumpToNode(targetId);
  };

  return (
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
                              className={`${tokenProps.className ?? ""} cursor-pointer hover:underline`}
                              style={{ ...tokenProps.style }}
                              title={`Go to definition: ${token.content.trim()}`}
                            />
                          );
                        }
                        return <span key={key} {...tokenProps} />;
                      })}
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
  );
}

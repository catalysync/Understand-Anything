// Wave-5 feature 49 — export a trace (or an ExplainPanel Q&A session) as a
// Markdown "trace note". Pure string builders (no React, no store) so they can
// be reasoned about + unit-tested in isolation; the UI just calls these and
// copies/downloads the result. Mirrors the ExportMenu download pattern.
import type { GraphNode } from "@understand-anything/core/types";
import type { ChatTurn } from "./useCodeAssist";

/** A `file:lineStart-lineEnd` label for a node (or "—" when unknown). */
function locOf(node: GraphNode): string {
  if (!node.filePath) return "—";
  if (!node.lineRange) return node.filePath;
  return `${node.filePath}:${node.lineRange[0]}-${node.lineRange[1]}`;
}

/**
 * Render the current trace as a nested call-list in Markdown. Hops are indented
 * by a clamped position so the file reads like a call tree, each with a
 * `file:lineRange` code-span link and its summary.
 */
export function traceToMarkdown(
  rootNode: GraphNode,
  hops: GraphNode[],
  direction: "callees" | "callers",
): string {
  const lines: string[] = [];
  lines.push(`# Trace note — ${rootNode.name}`);
  lines.push("");
  lines.push(`> Rooted at \`${rootNode.name}\` (\`${locOf(rootNode)}\`) · direction: **${direction}** · ${hops.length} hop${hops.length === 1 ? "" : "s"}`);
  lines.push("");
  lines.push("## Call list");
  lines.push("");
  hops.forEach((h, i) => {
    const indent = "  ".repeat(Math.min(i, 8));
    const summary = h.summary?.trim() ? h.summary.trim().replace(/\s*\n\s*/g, " ") : "_(no summary)_";
    lines.push(`${indent}- **${h.name}** — \`${locOf(h)}\``);
    lines.push(`${indent}  ${summary}`);
  });
  lines.push("");
  lines.push(`_Generated from the Understand-Anything trace view._`);
  return lines.join("\n");
}

/**
 * Render an ExplainPanel session (initial explanation + follow-up thread) as a
 * Markdown "trace note" — a Q&A transcript anchored to the hop it was opened on.
 */
export function sessionToMarkdown(
  anchor: GraphNode | null,
  title: string,
  explanation: string | null,
  thread: ChatTurn[],
): string {
  const lines: string[] = [];
  lines.push(`# Trace note — ${title}`);
  if (anchor) {
    lines.push("");
    lines.push(`> Anchored at \`${anchor.name}\` (\`${locOf(anchor)}\`)`);
  }
  lines.push("");
  if (explanation?.trim()) {
    lines.push("## Explanation");
    lines.push("");
    lines.push(explanation.trim());
    lines.push("");
  }
  if (thread.length > 0) {
    lines.push("## Q&A");
    lines.push("");
    for (const turn of thread) {
      if (turn.role === "user") {
        lines.push(`**Q:** ${turn.text.trim()}`);
      } else {
        lines.push("");
        lines.push(`**A:** ${turn.text.trim()}`);
        lines.push("");
      }
    }
  }
  lines.push(`_Generated from the Understand-Anything trace view._`);
  return lines.join("\n");
}

/** Trigger a browser download of a markdown string (ExportMenu pattern). */
export function downloadMarkdown(markdown: string, filename: string): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** A filesystem-safe slug for a node/trace name. */
export function slugify(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "trace";
}

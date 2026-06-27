import { useMemo, useState, useRef, useCallback } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 167: Hover-to-define jargon.
 *
 * Wrap rendered prose (NodeInfo summaries, LearnPanel descriptions) in
 * <JargonText> and any glossary/domain term that appears verbatim gets a dotted
 * underline; hovering shows a small definition popover with a link to the term's
 * node (focusEntity). Pure client-side — no model calls.
 */

interface GlossaryEntry {
  name: string;
  summary: string;
  nodeId: string;
  view: "structural" | "domain";
}

/** Build a lowercase term → entry index from concept/domain nodes. */
function useGlossaryIndex(): {
  byTerm: Map<string, GlossaryEntry>;
  pattern: RegExp | null;
} {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);

  return useMemo(() => {
    const byTerm = new Map<string, GlossaryEntry>();
    const add = (
      name: string,
      summary: string,
      nodeId: string,
      view: GlossaryEntry["view"],
    ) => {
      const key = name.trim().toLowerCase();
      // Only multi-char, word-ish terms; skip very short/ambiguous ones.
      if (key.length < 3) return;
      if (!/[a-z]/i.test(key)) return;
      if (byTerm.has(key)) return;
      byTerm.set(key, { name, summary, nodeId, view });
    };
    for (const n of graph?.nodes ?? []) {
      if (n.type === "concept") add(n.name, n.summary, n.id, "structural");
      else if (n.type === "domain") add(n.name, n.summary, n.id, "domain");
    }
    for (const n of domainGraph?.nodes ?? []) {
      if (n.type === "domain") add(n.name, n.summary, n.id, "domain");
      else if (n.type === "concept") add(n.name, n.summary, n.id, "structural");
    }

    if (byTerm.size === 0) return { byTerm, pattern: null };
    // Longest-first so multi-word terms win over their prefixes.
    const terms = Array.from(byTerm.keys()).sort((a, b) => b.length - a.length);
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    return { byTerm, pattern };
  }, [graph, domainGraph]);
}

interface PopoverState {
  entry: GlossaryEntry;
  x: number;
  y: number;
}

export default function JargonText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { byTerm, pattern } = useGlossaryIndex();
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPopover(null), 120);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const parts = useMemo(() => {
    if (!pattern || !text) return null;
    const out: Array<{ text: string; term: boolean }> = [];
    let last = 0;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), term: false });
      out.push({ text: m[0], term: true });
      last = m.index + m[0].length;
      if (m.index === pattern.lastIndex) pattern.lastIndex++; // avoid zero-width loops
    }
    if (last < text.length) out.push({ text: text.slice(last), term: false });
    return out;
  }, [pattern, text]);

  if (!parts || parts.every((p) => !p.term)) {
    return <span className={className}>{text}</span>;
  }

  const open = (entry: GlossaryEntry) => {
    setPopover(null);
    if (entry.view === "domain") navigateToDomain(entry.nodeId);
    else focusEntity(entry.nodeId, { view: entry.view });
  };

  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (!p.term) return <span key={i}>{p.text}</span>;
        const entry = byTerm.get(p.text.toLowerCase());
        if (!entry) return <span key={i}>{p.text}</span>;
        return (
          <span
            key={i}
            className="cursor-help underline decoration-dotted decoration-accent/60 underline-offset-2 hover:text-accent transition-colors"
            onMouseEnter={(e) => {
              cancelClose();
              setPopover({ entry, x: e.clientX, y: e.clientY });
            }}
            onMouseLeave={scheduleClose}
            onClick={() => open(entry)}
          >
            {p.text}
          </span>
        );
      })}
      {popover && (
        <span
          className="fixed z-[60] w-72 rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden block text-left"
          style={{
            left: Math.max(
              8,
              Math.min(
                popover.x,
                (typeof window !== "undefined" ? window.innerWidth : 1200) - 300,
              ),
            ),
            top: popover.y + 14,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <span className="px-3 py-2 border-b border-border-subtle flex items-center gap-2 block">
            <span
              className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                color: "var(--color-accent)",
                backgroundColor:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            >
              {popover.entry.view === "domain" ? "domain" : "concept"}
            </span>
            <span className="text-[13px] font-medium text-text-primary truncate">
              {popover.entry.name}
            </span>
          </span>
          <span className="px-3 py-2 block">
            <span className="text-[11px] text-text-secondary leading-relaxed line-clamp-4 block">
              {popover.entry.summary || "No definition available."}
            </span>
            <button
              type="button"
              onClick={() => open(popover.entry)}
              className="text-[10px] font-semibold text-accent hover:underline mt-2"
            >
              Go to definition →
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 165: auto-built project glossary.
 *
 * Lists every `concept` / `domain` node (from the structural graph AND the
 * domain graph) with its summary. Each term links to its node via focusEntity —
 * concepts/structural nodes land in the structural view, domains open in the
 * domain view. A small search box filters by name/summary.
 */

interface Term {
  id: string;
  name: string;
  summary: string;
  kind: "concept" | "domain";
  /** which view to focus the entity in when clicked */
  view: "structural" | "domain";
}

export default function GlossaryPanel({ onClose }: { onClose: () => void }) {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const [q, setQ] = useState("");

  const terms = useMemo<Term[]>(() => {
    const out: Term[] = [];
    const seen = new Set<string>();
    const push = (
      id: string,
      name: string,
      summary: string,
      kind: Term["kind"],
      view: Term["view"],
    ) => {
      const key = `${kind}:${name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id, name, summary, kind, view });
    };
    for (const n of graph?.nodes ?? []) {
      if (n.type === "concept") push(n.id, n.name, n.summary, "concept", "structural");
      else if (n.type === "domain") push(n.id, n.name, n.summary, "domain", "domain");
    }
    for (const n of domainGraph?.nodes ?? []) {
      if (n.type === "domain") push(n.id, n.name, n.summary, "domain", "domain");
      else if (n.type === "concept") push(n.id, n.name, n.summary, "concept", "structural");
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [graph, domainGraph]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return terms;
    return terms.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.summary.toLowerCase().includes(needle),
    );
  }, [terms, q]);

  const open = (t: Term) => {
    if (t.view === "domain" && t.kind === "domain") navigateToDomain(t.id);
    else focusEntity(t.id, { view: t.view });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[620px] max-h-[80vh] flex flex-col rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle shrink-0">
          <div>
            <h2 className="font-heading text-lg text-text-primary">Glossary</h2>
            <p className="text-[11px] text-text-muted">
              {terms.length} concept{terms.length === 1 ? "" : "s"} &amp; domains in this project
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none"
            aria-label="Close glossary"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border-subtle shrink-0">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter terms…"
            className="w-full bg-elevated rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted border border-border-subtle focus:border-accent/50 outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {filtered.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-10">
              {terms.length === 0
                ? "No concept or domain nodes were found in this graph."
                : "No terms match your filter."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((t) => (
                <button
                  key={`${t.kind}-${t.id}`}
                  type="button"
                  onClick={() => open(t)}
                  className="w-full text-left bg-elevated hover:bg-accent/10 border border-border-subtle hover:border-accent/40 rounded-lg px-3 py-2.5 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
                      {t.name}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface text-text-muted">
                      {t.kind}
                    </span>
                  </div>
                  {t.summary && (
                    <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">
                      {t.summary}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

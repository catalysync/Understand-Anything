import { useDashboardStore } from "../store";
import type { ViewMode } from "../store";

/**
 * Item 170: Context-sensitive help drawer.
 *
 * A right-side drawer (opened by the header `?` button) whose content changes
 * by the active view — structural / domain / trace / data / knowledge. It
 * explains what's on screen and lists the key controls for that view.
 */

interface HelpSection {
  title: string;
  blurb: string;
  controls: { keys: string; desc: string }[];
}

const HELP: Record<ViewMode, HelpSection> = {
  structural: {
    title: "Structural graph",
    blurb:
      "The architecture map: files, functions and classes grouped into logical layers. Edges are imports/calls. Click a node to inspect it; drill into a layer or container to expand it.",
    controls: [
      { keys: "Click", desc: "Select a node — inspector opens on the right" },
      { keys: "Double-click", desc: "Drill into a layer / container" },
      { keys: "⌘K", desc: "Symbol palette — jump to anything" },
      { keys: "Right-click", desc: "Node menu: Trace · Explain · Show-in-domain" },
      { keys: "F", desc: "Filter panel (type/tag/complexity/degree)" },
    ],
  },
  domain: {
    title: "Domain flows",
    blurb:
      "Business-level view: domains contain ordered flows, flows contain steps. Cross-domain edges show how business processes hand off. Each step links back to the code that implements it.",
    controls: [
      { keys: "Click domain", desc: "Expand its flows and steps" },
      { keys: "Step → code", desc: "Open the implementing file" },
      { keys: "Step → trace", desc: "Trace the code behind a step" },
      { keys: "Entry badge", desc: "Marks where a flow starts" },
    ],
  },
  trace: {
    title: "Trace tree",
    blurb:
      "A call/data trace rooted at one node. Follow how a request flows through the code. Fold/mute branches to focus; explain any hop with Claude.",
    controls: [
      { keys: "Click hop", desc: "Expand its children" },
      { keys: "Depth", desc: "Control how many hops to follow" },
      { keys: "Direction", desc: "Callers (up) vs callees (down)" },
      { keys: "✦ Explain", desc: "Ask Claude about a hop" },
    ],
  },
  data: {
    title: "Data view",
    blurb:
      "Tables, columns, queries and the relationships between them. See which code reads/writes each table and follow inferred foreign keys.",
    controls: [
      { keys: "Click table", desc: "Inspect columns and relations" },
      { keys: "Edge", desc: "read / write access is colour-coded" },
    ],
  },
  knowledge: {
    title: "Knowledge graph",
    blurb:
      "Concept-level view of a documentation/wiki knowledge base: entities, claims and topic clusters with implicit relationships.",
    controls: [
      { keys: "Click", desc: "Select a concept / entity" },
      { keys: "⌘K", desc: "Search across concepts" },
    ],
  },
};

const APP_WIDE: { keys: string; desc: string }[] = [
  { keys: "⌘,", desc: "Settings (persona, theme, landing view)" },
  { keys: "Tabs", desc: "Switch view: structural · domain · trace · data" },
  { keys: "Bookmark", desc: "Pin nodes; build flashcards & tours from them" },
];

export default function HelpDrawer({ onClose }: { onClose: () => void }) {
  const viewMode = useDashboardStore((s) => s.viewMode);
  const section = HELP[viewMode] ?? HELP.structural;

  return (
    <div className="fixed inset-0 z-[68] flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <aside
        className="relative w-full max-w-[380px] h-full bg-surface border-l border-border-medium shadow-2xl flex flex-col animate-fade-slide-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle shrink-0">
          <div>
            <h2 className="font-heading text-lg text-text-primary">Help</h2>
            <p className="text-[11px] text-text-muted">
              Showing help for the {section.title.toLowerCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none"
            aria-label="Close help"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          <section className="mb-6">
            <h3 className="text-sm font-semibold text-accent mb-1.5">
              {section.title}
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed mb-3">
              {section.blurb}
            </p>
            <ul className="space-y-1.5">
              {section.controls.map((c) => (
                <li key={c.keys} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-elevated border border-border-subtle text-text-primary shrink-0 min-w-[44px] text-center">
                    {c.keys}
                  </span>
                  <span className="text-text-secondary leading-relaxed">
                    {c.desc}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-2">
              Everywhere
            </h3>
            <ul className="space-y-1.5">
              {APP_WIDE.map((c) => (
                <li key={c.keys} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-elevated border border-border-subtle text-text-primary shrink-0 min-w-[44px] text-center">
                    {c.keys}
                  </span>
                  <span className="text-text-secondary leading-relaxed">
                    {c.desc}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}

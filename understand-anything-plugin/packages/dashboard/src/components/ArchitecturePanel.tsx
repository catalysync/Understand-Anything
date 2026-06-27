// ── Architecture panel (300-series items 9-10, 22, 26) ─────────────────────
//
// A floating, tabbed panel over the structural graph with three sub-views:
//   • Rules   — editable layer-import boundary rules + live violation list (26)
//   • Events  — event-bus map: producers / consumers + orphan flags (9-10)
//   • API     — public-surface snapshot, copyable as committable Markdown (22)
//
// All views degrade to clean empty-states when the operations-layer graph is
// sparse. Reads/writes the store; persists rules to localStorage.
import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import {
  computeBoundaryViolations,
  eventBusMap,
  hasEventBus,
  apiSurface,
  apiSurfaceMarkdown,
} from "../utils/archLayer";
import { nodeTypeIcon } from "../utils/opsLayer";

type ArchView = "rules" | "events" | "api";
const ARCH_VIEW_KEY = "ua-arch-view-v1";

function readArchView(): ArchView {
  if (typeof window === "undefined") return "rules";
  try {
    const v = window.localStorage.getItem(ARCH_VIEW_KEY);
    if (v === "rules" || v === "events" || v === "api") return v;
  } catch { /* ignore */ }
  return "rules";
}

// ── Rules view (item 26) ────────────────────────────────────────────────────
function RulesView() {
  const graph = useDashboardStore((s) => s.graph);
  const archRules = useDashboardStore((s) => s.archRules);
  const toggleArchRule = useDashboardStore((s) => s.toggleArchRule);
  const addArchRule = useDashboardStore((s) => s.addArchRule);
  const removeArchRule = useDashboardStore((s) => s.removeArchRule);
  const resetArchRules = useDashboardStore((s) => s.resetArchRules);
  const boundaryOverlay = useDashboardStore((s) => s.boundaryOverlay);
  const toggleBoundaryOverlay = useDashboardStore((s) => s.toggleBoundaryOverlay);
  const focusEntity = useDashboardStore((s) => s.focusEntity);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const layerName = useMemo(
    () => new Map((graph?.layers ?? []).map((l) => [l.id, l.name] as const)),
    [graph],
  );
  const ruleLabel = (id: string) => {
    if (id === "*") return "Any layer";
    if (id === "^above") return "any higher layer";
    return layerName.get(id) ?? id;
  };

  const violations = useMemo(
    () => computeBoundaryViolations(graph, archRules),
    [graph, archRules],
  );

  if (!graph) return null;

  return (
    <div className="px-3 py-3 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-text-muted leading-relaxed flex-1">
          Rules forbid <span className="font-mono">imports</span> edges crossing
          layer boundaries. Defaults derive a "no upward dependency" rule per
          layer from the layer order.
        </p>
        <button
          type="button"
          onClick={toggleBoundaryOverlay}
          title="Highlight violating import edges in red on the graph"
          className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
            boundaryOverlay
              ? "border-[#d35d6e]/50 bg-[#d35d6e]/10 text-[#d35d6e]"
              : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
          }`}
        >
          Highlight
        </button>
      </div>

      {/* Rule list */}
      <div className="space-y-1">
        {archRules.length === 0 ? (
          <div className="text-[11px] text-text-muted px-1">No rules.</div>
        ) : (
          archRules.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 text-xs bg-elevated rounded-lg px-2.5 py-1.5 border border-border-subtle"
            >
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={() => toggleArchRule(r.id)}
                className="shrink-0 accent-[#d35d6e]"
                title={r.enabled ? "Disable rule" : "Enable rule"}
              />
              <span className="flex-1 min-w-0 truncate text-text-secondary">
                <span className="text-text-primary">{ruleLabel(r.fromLayerId)}</span>
                <span className="text-text-muted"> ⊁ </span>
                <span className="text-text-primary">{ruleLabel(r.toLayerId)}</span>
                {r.derived && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-wider text-text-muted">
                    default
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeArchRule(r.id)}
                className="shrink-0 text-text-muted hover:text-[#d35d6e]"
                title="Remove rule"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add a rule */}
      <div className="flex items-center gap-1.5">
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="flex-1 min-w-0 bg-surface text-text-primary text-[11px] rounded-md px-1.5 py-1 border border-border-subtle focus:outline-none focus:border-accent/50"
        >
          <option value="">From layer…</option>
          <option value="*">Any layer</option>
          {graph.layers.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <span className="text-text-muted text-xs shrink-0">⊁</span>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="flex-1 min-w-0 bg-surface text-text-primary text-[11px] rounded-md px-1.5 py-1 border border-border-subtle focus:outline-none focus:border-accent/50"
        >
          <option value="">To layer…</option>
          {graph.layers.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!from || !to || from === to}
          onClick={() => { addArchRule(from, to); setFrom(""); setTo(""); }}
          className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-2 py-1.5 rounded border border-accent/30 text-accent hover:text-accent-bright disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
        <button
          type="button"
          onClick={resetArchRules}
          title="Reset to derived defaults"
          className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-2 py-1.5 rounded border border-border-medium text-text-muted hover:text-text-secondary transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Violations */}
      <div>
        <div className={`text-[10px] uppercase tracking-wider mb-1.5 ${violations.length > 0 ? "text-[#d35d6e]" : "text-[#5a9e6f]"}`}>
          {violations.length === 0
            ? "No boundary violations ✓"
            : `${violations.length} violation${violations.length === 1 ? "" : "s"}`}
        </div>
        <div className="space-y-1 max-h-48 overflow-auto">
          {violations.map((v) => (
            <button
              key={v.edgeKey}
              type="button"
              onClick={() => focusEntity(v.source.id, { view: "structural" })}
              className="w-full text-left text-xs bg-[#d35d6e]/5 rounded-lg px-2.5 py-1.5 border border-[#d35d6e]/30 hover:border-[#d35d6e]/60 transition-colors"
              title={`${v.source.name} imports ${v.target.name}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-text-primary truncate">{v.source.name}</span>
                <span className="text-[#d35d6e] shrink-0">→</span>
                <span className="text-text-primary truncate">{v.target.name}</span>
              </div>
              <div className="text-[9px] text-text-muted truncate mt-0.5">
                {v.fromLayerName} → {v.toLayerName}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Events view (items 9-10) ────────────────────────────────────────────────
function EventsView() {
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const entries = useMemo(() => eventBusMap(graph), [graph]);

  if (!hasEventBus(graph)) {
    return (
      <div className="px-4 py-6 text-[11px] text-text-muted leading-relaxed">
        No event / topic nodes in this graph — re-index with the operations-layer
        analyzer to populate the event bus.
      </div>
    );
  }

  const orphanRed = entries.filter((e) => e.orphan === "produced-never-consumed").length;
  const orphanAmber = entries.filter((e) => e.orphan === "consumed-never-produced").length;

  return (
    <div className="px-3 py-3 space-y-3">
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-text-muted">{entries.length} events</span>
        {orphanRed > 0 && (
          <span className="text-[#d35d6e]">● {orphanRed} produced-never-consumed</span>
        )}
        {orphanAmber > 0 && (
          <span className="text-[#d4a574]">● {orphanAmber} consumed-never-produced</span>
        )}
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-auto">
        {entries.map((e) => {
          const ring =
            e.orphan === "produced-never-consumed"
              ? "border-[#d35d6e]/50 bg-[#d35d6e]/5"
              : e.orphan === "consumed-never-produced"
                ? "border-[#d4a574]/50 bg-[#d4a574]/5"
                : "border-border-subtle bg-elevated";
          return (
            <div key={e.node.id} className={`rounded-lg px-2.5 py-2 border ${ring}`}>
              <button
                type="button"
                onClick={() => focusEntity(e.node.id, { view: "structural" })}
                className="w-full flex items-center gap-1.5 text-xs text-left mb-1.5 hover:text-accent transition-colors"
              >
                <span aria-hidden>{nodeTypeIcon(e.node.type)}</span>
                <span className="text-text-primary truncate flex-1 font-mono">{e.node.name}</span>
                {e.orphan === "produced-never-consumed" && (
                  <span className="text-[8px] uppercase tracking-wider text-[#d35d6e] shrink-0">orphan</span>
                )}
                {e.orphan === "consumed-never-produced" && (
                  <span className="text-[8px] uppercase tracking-wider text-[#d4a574] shrink-0">no producer</span>
                )}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-text-muted mb-0.5">
                    Producers ({e.producers.length})
                  </div>
                  {e.producers.length === 0 ? (
                    <div className="text-[10px] text-[#d4a574]">none</div>
                  ) : (
                    e.producers.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => focusEntity(p.id, { view: "structural" })}
                        className="block w-full text-left text-[10px] text-text-secondary truncate hover:text-accent"
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-text-muted mb-0.5">
                    Consumers ({e.consumers.length})
                  </div>
                  {e.consumers.length === 0 ? (
                    <div className="text-[10px] text-[#d35d6e]">none</div>
                  ) : (
                    e.consumers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => focusEntity(c.id, { view: "structural" })}
                        className="block w-full text-left text-[10px] text-text-secondary truncate hover:text-accent"
                      >
                        {c.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── API surface view (item 22) ──────────────────────────────────────────────
function ApiSurfaceView() {
  const graph = useDashboardStore((s) => s.graph);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const [copied, setCopied] = useState(false);
  const files = useMemo(() => apiSurface(graph), [graph]);
  const total = files.reduce((n, f) => n + f.symbols.length, 0);

  const onCopy = () => {
    const md = apiSurfaceMarkdown(files, graph?.project?.name);
    try {
      void navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  if (files.length === 0) {
    return (
      <div className="px-4 py-6 text-[11px] text-text-muted leading-relaxed">
        No public symbols detected — nothing is exported or referenced across a
        file/layer boundary yet.
      </div>
    );
  }

  return (
    <div className="px-3 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-text-muted">
          {total} public symbol{total === 1 ? "" : "s"} · {files.length} file{files.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="text-[9px] font-semibold uppercase tracking-wider px-2 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright transition-colors"
        >
          {copied ? "Copied ✓" : "Copy Markdown"}
        </button>
      </div>
      <div className="space-y-3 max-h-[60vh] overflow-auto">
        {files.map((f) => (
          <div key={f.label}>
            <div className="text-[10px] font-mono text-accent truncate mb-1" title={f.label}>
              {f.label}
              {f.layerName && <span className="text-text-muted ml-1.5 normal-case">· {f.layerName}</span>}
            </div>
            <div className="space-y-0.5 pl-2 border-l border-border-subtle">
              {f.symbols.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => focusEntity(s.id, { view: "structural" })}
                  className="w-full flex items-center gap-1.5 text-[11px] text-left hover:text-accent transition-colors"
                >
                  <span className="font-mono text-text-primary truncate flex-1">{s.name}</span>
                  <span className="text-[8px] uppercase tracking-wider text-text-muted shrink-0">{s.type}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ArchitecturePanel() {
  const open = useDashboardStore((s) => s.archPanelOpen);
  const setOpen = useDashboardStore((s) => s.setArchPanelOpen);
  const [view, setView] = useState<ArchView>(readArchView);

  const setViewPersisted = (v: ArchView) => {
    setView(v);
    try { window.localStorage.setItem(ARCH_VIEW_KEY, v); } catch { /* ignore */ }
  };

  if (!open) return null;

  const tabs: { id: ArchView; label: string }[] = [
    { id: "rules", label: "Rules" },
    { id: "events", label: "Events" },
    { id: "api", label: "API" },
  ];

  return (
    <div className="absolute top-4 right-4 z-20 rounded-xl border border-border-medium bg-surface/95 shadow-2xl backdrop-blur-sm w-[420px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setViewPersisted(tb.id)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                view === tb.id
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-elevated"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          aria-label="Close architecture panel"
        >
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {view === "rules" ? <RulesView /> : view === "events" ? <EventsView /> : <ApiSurfaceView />}
      </div>
    </div>
  );
}

// Wave-1 trace navigation toolbar. Owns the global controls: direction
// toggle (callees/callers), depth slider, layout switch, fold-by-name input,
// blackbox/mute packages panel, critical-path toggle, and the "Path to…"
// mode. All state lives in the store; this component just renders + dispatches.
import React, { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import Collapsible from "./Collapsible";
import { packageLabel } from "./traceGraph";
import { COLOR_DIMENSIONS, type ColorDimension } from "./traceColor";
import type { GraphNode } from "@understand-anything/core/types";

const btnBase =
  "text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded border transition-colors";
const btnIdle = "border-border-subtle text-text-muted hover:text-text-primary hover:border-border-medium";
const btnActive = "border-accent/60 text-accent bg-accent/10";

/** A labeled sub-section so the wall of controls reads as View · Filter · Highlight · Analyze. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted/70 select-none">
        {label}
      </span>
      <div className="w-px self-stretch bg-border-subtle/60" />
      {children}
    </div>
  );
}

export default function TraceControls({
  packagesPresent,
  searchResults,
  onPickPathTarget,
}: {
  packagesPresent: string[];
  searchResults: GraphNode[];
  onPickPathTarget: (id: string) => void;
}) {
  const direction = useDashboardStore((s) => s.traceDirection);
  const setDirection = useDashboardStore((s) => s.setTraceDirection);
  const depth = useDashboardStore((s) => s.traceDepth);
  const setDepth = useDashboardStore((s) => s.setTraceDepth);
  const layout = useDashboardStore((s) => s.traceLayout);
  const setLayout = useDashboardStore((s) => s.setTraceLayout);
  const foldedPatterns = useDashboardStore((s) => s.traceFoldedPatterns);
  const addFoldPattern = useDashboardStore((s) => s.addFoldPattern);
  const removeFoldPattern = useDashboardStore((s) => s.removeFoldPattern);
  const mutedPackages = useDashboardStore((s) => s.traceMutedPackages);
  const toggleMutedPackage = useDashboardStore((s) => s.toggleMutedPackage);
  const criticalPath = useDashboardStore((s) => s.traceCriticalPath);
  const toggleCriticalPath = useDashboardStore((s) => s.toggleCriticalPath);
  const pathTarget = useDashboardStore((s) => s.tracePathTarget);
  const setPathTarget = useDashboardStore((s) => s.setPathTarget);
  const colorBy = useDashboardStore((s) => s.traceColorBy);
  const setColorBy = useDashboardStore((s) => s.setTraceColorBy);

  const [foldDraft, setFoldDraft] = useState("");
  const [muteOpen, setMuteOpen] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  const [pathQuery, setPathQuery] = useState("");

  const mutedCount = mutedPackages.size;
  const pathResults = useMemo(() => {
    if (!pathQuery.trim()) return searchResults.slice(0, 8);
    const q = pathQuery.toLowerCase();
    return searchResults.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 8);
  }, [pathQuery, searchResults]);

  return (
    <Collapsible
      storageKey="ua-trace-controls-open-v1"
      label="Controls"
      testId="trace-controls"
      right={
        <span className="text-[9px] uppercase tracking-wider text-text-muted/60 truncate">
          {direction} · depth {depth} · {layout}
          {mutedCount > 0 ? ` · ${mutedCount} muted` : ""}
          {pathTarget ? " · path" : ""}
        </span>
      }
    >
      <div className="flex flex-col gap-2.5">
      {/* ── View ─────────────────────────────────────────── */}
      <Section label="View">
        {/* Direction toggle */}
        <div className="flex rounded border border-border-subtle overflow-hidden">
          <button
            type="button"
            onClick={() => setDirection("callees")}
            className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 transition-colors ${
              direction === "callees" ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
            }`}
            title="Walk down into callees"
          >
            Callees ▼
          </button>
          <button
            type="button"
            onClick={() => setDirection("callers")}
            className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 transition-colors border-l border-border-subtle ${
              direction === "callers" ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
            }`}
            title="Walk up into callers"
          >
            Callers ▲
          </button>
        </div>

        {/* Depth slider */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border-subtle">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">Depth</span>
          <input
            type="range"
            min={1}
            max={6}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-20 accent-accent"
            title={`Trace depth: ${depth}`}
            aria-label="Trace depth"
          />
          <span className="text-[11px] font-mono text-text-primary w-3">{depth}</span>
        </div>

        {/* Layout switch */}
        <div className="flex rounded border border-border-subtle overflow-hidden">
          {(["nested", "flat", "shape"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1.5 transition-colors border-l border-border-subtle first:border-l-0 ${
                layout === l ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
              }`}
              title={`${l} layout`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Wave-5 feature 44: Color-by dimension */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border-subtle">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">Color by</span>
          <select
            data-testid="color-by-select"
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as ColorDimension)}
            className="bg-surface text-text-primary text-[11px] rounded px-1.5 py-0.5 border border-border-subtle focus:outline-none focus:border-accent/50"
            title="Recolor each hop rail/badge by a dimension"
          >
            {COLOR_DIMENSIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {/* ── Analyze ──────────────────────────────────────── */}
      <Section label="Analyze">
        {/* Critical path */}
        <button
          type="button"
          onClick={toggleCriticalPath}
          className={`${btnBase} ${criticalPath ? btnActive : btnIdle}`}
          title="Highlight the longest call chain from the root"
        >
          ◆ Critical path
        </button>

        {/* Path-to mode */}
        <button
          type="button"
          onClick={() => setPathOpen((v) => !v)}
          className={`${btnBase} ${pathTarget ? btnActive : btnIdle}`}
          title="Find the shortest path from the root to a target node"
        >
          ↪ Path to…
        </button>
        {pathTarget && (
          <button
            type="button"
            onClick={() => setPathTarget(null)}
            className={`${btnBase} ${btnIdle}`}
            title="Exit path mode"
          >
            ✕ Clear path
          </button>
        )}
      </Section>

      {/* ── Filter ───────────────────────────────────────── */}
      <Section label="Filter">
        {/* Blackbox / mute packages */}
        <button
          type="button"
          onClick={() => setMuteOpen((v) => !v)}
          className={`${btnBase} ${mutedCount > 0 ? btnActive : btnIdle}`}
          title="Mute / blackbox packages"
        >
          ⬚ Blackbox{mutedCount > 0 ? ` (${mutedCount})` : ""}
        </button>

        {/* Fold-by-name input + chips */}
        <span className="text-[10px] uppercase tracking-wider text-text-muted ml-1">Fold</span>
        <input
          type="text"
          value={foldDraft}
          onChange={(e) => setFoldDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && foldDraft.trim()) {
              addFoldPattern(foldDraft.trim());
              setFoldDraft("");
            }
          }}
          placeholder="hide hops by name (e.g. log, get*)"
          className="bg-surface text-text-primary text-[11px] rounded px-2 py-1 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted w-56"
        />
        {foldedPatterns.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => removeFoldPattern(p)}
            className="text-[10px] font-mono px-2 py-1 rounded border border-gold/40 text-gold hover:text-gold-bright hover:border-gold/70 transition-colors"
            title="Remove fold pattern"
          >
            {p} ✕
          </button>
        ))}
      </Section>

      {/* Blackbox panel */}
      {muteOpen && (
        <div className="rounded border border-border-subtle bg-surface/60 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
            Packages in trace — toggle to mute
          </div>
          {packagesPresent.length === 0 ? (
            <div className="text-[11px] text-text-muted">No packages in the current trace.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {packagesPresent.map((pkg) => {
                const muted = mutedPackages.has(pkg);
                return (
                  <button
                    key={pkg}
                    type="button"
                    onClick={() => toggleMutedPackage(pkg)}
                    className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                      muted
                        ? "border-text-muted/40 text-text-muted line-through bg-surface"
                        : "border-accent/30 text-accent hover:border-accent/60"
                    }`}
                    title={muted ? `Un-mute ${pkg}` : `Mute ${pkg}`}
                  >
                    {muted ? "🔇 " : ""}
                    {packageLabel(pkg)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Path-to picker */}
      {pathOpen && (
        <div className="rounded border border-border-subtle bg-surface/60 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
            Pick a target node — shortest call path from the root
          </div>
          <input
            type="text"
            value={pathQuery}
            onChange={(e) => setPathQuery(e.target.value)}
            placeholder="search target node…"
            className="w-full bg-surface text-text-primary text-[11px] rounded px-2 py-1 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted mb-2"
          />
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
            {pathResults.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  onPickPathTarget(n.id);
                  setPathOpen(false);
                }}
                className="text-[10px] font-mono px-2 py-1 rounded border border-node-schema/40 text-node-schema hover:border-node-schema/70 transition-colors"
                title={n.filePath ?? n.name}
              >
                {n.name}
              </button>
            ))}
            {pathResults.length === 0 && (
              <span className="text-[11px] text-text-muted">No matches.</span>
            )}
          </div>
        </div>
      )}
      </div>
    </Collapsible>
  );
}

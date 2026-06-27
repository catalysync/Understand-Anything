import { useMemo } from "react";
import { useDashboardStore } from "../store";
import {
  buildCurriculum,
  phaseLabel,
  type CurriculumModule,
  type ModulePhase,
} from "../utils/curriculum";
import TrackSelector from "./TrackSelector";

/**
 * Item 154: Curriculum from layers.
 *
 * An ordered "course" of modules (foundations → core → features → infra)
 * derived from the graph's layers + fan-in ranking. Each module lists its key
 * nodes (click → focus). Completed modules are tracked in localStorage and a
 * progress bar shows how far through the course you are. Item 157's role track
 * scopes which layers/nodes appear.
 */

const PHASE_DOT: Record<ModulePhase, string> = {
  foundations: "bg-emerald-400",
  core: "bg-accent",
  features: "bg-sky-400",
  infra: "bg-purple-400",
};

export default function CurriculumPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const track = useDashboardStore((s) => s.learning.curriculumTrack);
  const completedModules = useDashboardStore(
    (s) => s.learning.completedModules,
  );
  const toggleModuleComplete = useDashboardStore(
    (s) => s.toggleModuleComplete,
  );
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const markVisited = useDashboardStore((s) => s.markVisited);

  const modules = useMemo<CurriculumModule[]>(
    () => (graph ? buildCurriculum(graph, { track }) : []),
    [graph, track],
  );

  const done = useMemo(() => new Set(completedModules), [completedModules]);
  const doneCount = modules.filter((m) => done.has(m.id)).length;
  const pct = modules.length
    ? Math.round((doneCount / modules.length) * 100)
    : 0;

  const open = (nodeId: string) => {
    markVisited(nodeId);
    focusEntity(nodeId, { view: "structural" });
  };

  // Group modules by phase, preserving the buildCurriculum ordering.
  const byPhase = useMemo(() => {
    const groups: { phase: ModulePhase; mods: CurriculumModule[] }[] = [];
    for (const m of modules) {
      let g = groups.find((x) => x.phase === m.phase);
      if (!g) {
        g = { phase: m.phase, mods: [] };
        groups.push(g);
      }
      g.mods.push(m);
    }
    return groups;
  }, [modules]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <TrackSelector />
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-elevated overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-text-muted font-mono shrink-0">
            {doneCount}/{modules.length} · {pct}%
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
        {modules.length === 0 ? (
          <p className="text-center text-text-muted text-sm py-10">
            No modules for this track. Try a different track.
          </p>
        ) : (
          <ol className="space-y-4">
            {byPhase.map((group) => (
              <li key={group.phase}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`w-2 h-2 rounded-full ${PHASE_DOT[group.phase]}`}
                  />
                  <span className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                    {phaseLabel(group.phase)}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.mods.map((m) => {
                    const isDone = done.has(m.id);
                    const number =
                      modules.findIndex((x) => x.id === m.id) + 1;
                    return (
                      <div
                        key={m.id}
                        className={`rounded-lg border px-3 py-2.5 transition-colors ${
                          isDone
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border-subtle bg-elevated"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => toggleModuleComplete(m.id)}
                            className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center text-[10px] ${
                              isDone
                                ? "bg-emerald-500 border-emerald-500 text-black"
                                : "border-border-medium text-transparent hover:border-accent"
                            }`}
                            aria-label={
                              isDone
                                ? "Mark module incomplete"
                                : "Mark module complete"
                            }
                            title={
                              isDone ? "Completed" : "Mark complete"
                            }
                          >
                            ✓
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-text-muted">
                                {String(number).padStart(2, "0")}
                              </span>
                              <span
                                className={`text-sm font-medium truncate ${
                                  isDone
                                    ? "text-text-muted line-through"
                                    : "text-text-primary"
                                }`}
                              >
                                {m.title}
                              </span>
                            </div>
                            {m.description && (
                              <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 mt-0.5">
                                {m.description}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {m.nodes.map((n) => (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => open(n.id)}
                                  className="text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-text-secondary hover:text-accent hover:border-accent/40 transition-colors max-w-[140px] truncate"
                                  title={`${n.name} — focus in graph${
                                    n.fanIn ? ` · ${n.fanIn} dependents` : ""
                                  }`}
                                >
                                  {n.name}
                                </button>
                              ))}
                              {m.totalNodes > m.nodes.length && (
                                <span className="text-[11px] px-1 py-0.5 text-text-muted">
                                  +{m.totalNodes - m.nodes.length} more
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

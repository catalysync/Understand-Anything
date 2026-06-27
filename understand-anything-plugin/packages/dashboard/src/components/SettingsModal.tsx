// Item 200b: a single Settings modal consolidating persona, theme, "New to
// <Language>?", default trace depth/direction, and default landing view —
// reachable from the header and the command palette. Trace defaults + landing
// view persist to localStorage (outside the workspace whitelist); persona +
// theme + language-axis persist via their own existing mechanisms.

import { useEffect, useMemo } from "react";
import { useDashboardStore } from "../store";
import type { Persona, ViewMode } from "../store";
import { useTheme, PRESETS } from "../themes/index.ts";

const PERSONAS: { id: Persona; label: string }[] = [
  { id: "non-technical", label: "Overview" },
  { id: "junior", label: "Learn" },
  { id: "experienced", label: "Deep dive" },
];

const LANDING_VIEWS: { id: ViewMode | "auto"; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "structural", label: "Structural" },
  { id: "domain", label: "Domain" },
  { id: "trace", label: "Trace" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border-subtle last:border-0">
      <span className="text-[13px] text-text-secondary shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-wrap justify-end">{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
        active
          ? "bg-accent/20 text-accent"
          : "text-text-muted hover:text-text-secondary bg-elevated"
      }`}
    >
      {children}
    </button>
  );
}

export default function SettingsModal() {
  const open = useDashboardStore((s) => s.settingsModalOpen);
  const setOpen = useDashboardStore((s) => s.setSettingsModalOpen);
  const persona = useDashboardStore((s) => s.persona);
  const setPersona = useDashboardStore((s) => s.setPersona);
  const settings = useDashboardStore((s) => s.settings);
  const updateSettings = useDashboardStore((s) => s.updateSettings);
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const languageAxis = useDashboardStore((s) => s.learning.languageAxis);
  const toggleLanguageAxis = useDashboardStore((s) => s.toggleLanguageAxis);

  const { preset, setPreset } = useTheme();

  const hasLessons = useMemo(
    () => (graph?.tour ?? []).some((s) => !!s.languageLesson),
    [graph],
  );
  const lang = graph?.project.languages?.[0] ?? "this language";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[10vh] bg-black/55 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      data-testid="settings-modal"
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl border border-border-medium bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="font-heading text-base text-text-primary">Settings</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-text-muted hover:text-text-primary text-sm"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-2 max-h-[64vh] overflow-auto">
          <Row label="Persona">
            {PERSONAS.map((p) => (
              <Pill key={p.id} active={persona === p.id} onClick={() => setPersona(p.id)}>
                {p.label}
              </Pill>
            ))}
          </Row>

          <Row label="Theme">
            {PRESETS.map((pr) => (
              <Pill
                key={pr.id}
                active={preset.id === pr.id}
                onClick={() => setPreset(pr.id)}
              >
                {pr.name}
              </Pill>
            ))}
          </Row>

          {hasLessons && (
            <Row label={`New to ${lang}?`}>
              <Pill active={languageAxis} onClick={toggleLanguageAxis}>
                {languageAxis ? "On" : "Off"}
              </Pill>
            </Row>
          )}

          <Row label="Landing view">
            {LANDING_VIEWS.map((v) => {
              const disabled = v.id === "domain" && !domainGraph;
              return (
                <Pill
                  key={v.id}
                  active={settings.defaultLandingView === v.id}
                  onClick={() =>
                    !disabled && updateSettings({ defaultLandingView: v.id })
                  }
                >
                  {v.label}
                </Pill>
              );
            })}
          </Row>

          <Row label="Default trace depth">
            {[2, 3, 4, 5, 6].map((d) => (
              <Pill
                key={d}
                active={settings.defaultTraceDepth === d}
                onClick={() => updateSettings({ defaultTraceDepth: d })}
              >
                {d}
              </Pill>
            ))}
          </Row>

          <Row label="Default trace direction">
            <Pill
              active={settings.defaultTraceDirection === "callees"}
              onClick={() => updateSettings({ defaultTraceDirection: "callees" })}
            >
              Callees
            </Pill>
            <Pill
              active={settings.defaultTraceDirection === "callers"}
              onClick={() => updateSettings({ defaultTraceDirection: "callers" })}
            >
              Callers
            </Pill>
          </Row>
        </div>

        <div className="px-4 py-2.5 border-t border-border-subtle text-[10px] text-text-muted">
          Persona, theme &amp; language settings save automatically.
        </div>
      </div>
    </div>
  );
}

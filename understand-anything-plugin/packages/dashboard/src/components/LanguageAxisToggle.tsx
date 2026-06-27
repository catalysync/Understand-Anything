import { useMemo } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 149: "New to <Language>?" axis.
 *
 * A toggle, separate from persona, that — when on — expands every tour
 * `languageLesson` by default and surfaces idiom callouts (consumed by
 * LearnPanel). Only rendered when the project actually carries language lessons
 * in its tour. The label adapts to the project's primary language.
 */
export default function LanguageAxisToggle() {
  const graph = useDashboardStore((s) => s.graph);
  const languageAxis = useDashboardStore((s) => s.learning.languageAxis);
  const toggleLanguageAxis = useDashboardStore((s) => s.toggleLanguageAxis);

  const hasLessons = useMemo(
    () => (graph?.tour ?? []).some((s) => !!s.languageLesson),
    [graph],
  );

  if (!hasLessons) return null;

  const lang = graph?.project.languages?.[0] ?? "this language";

  return (
    <button
      type="button"
      onClick={toggleLanguageAxis}
      title={`Expand every language lesson + show ${lang} idiom callouts`}
      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors whitespace-nowrap ${
        languageAxis
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
      }`}
    >
      New to {lang}?
    </button>
  );
}

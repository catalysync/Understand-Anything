import { useState } from "react";
import CurriculumPanel from "./CurriculumPanel";
import PrerequisitePanel from "./PrerequisitePanel";
import FlashcardsPanel from "./FlashcardsPanel";
import AcronymsPanel from "./AcronymsPanel";

/**
 * The teaching hub (200-series onboarding long-tail). A single modal that hosts
 * the curriculum (154), prerequisite order (155), role tracks (157), flashcards
 * (163) and acronyms (168). Glossary/hover-define (167) and the help drawer
 * (170) live elsewhere; the recap (172) is a banner.
 */

type TeachTab = "curriculum" | "order" | "flashcards" | "acronyms";

const TABS: { id: TeachTab; label: string }[] = [
  { id: "curriculum", label: "Curriculum" },
  { id: "order", label: "Learn order" },
  { id: "flashcards", label: "Flashcards" },
  { id: "acronyms", label: "Acronyms" },
];

export default function TeachPanel({
  accessToken,
  onClose,
}: {
  accessToken: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TeachTab>("curriculum");

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[640px] h-[80vh] flex flex-col rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle shrink-0">
          <div>
            <h2 className="font-heading text-lg text-text-primary">
              Learn this codebase
            </h2>
            <p className="text-[11px] text-text-muted">
              A guided course, ordering, flashcards &amp; jargon — built from the
              graph.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none"
            aria-label="Close teaching panel"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-1 px-3 pt-2 pb-2 border-b border-border-subtle shrink-0">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                tab === tb.id
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-elevated"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0">
          {tab === "curriculum" && <CurriculumPanel />}
          {tab === "order" && <PrerequisitePanel />}
          {tab === "flashcards" && <FlashcardsPanel />}
          {tab === "acronyms" && <AcronymsPanel accessToken={accessToken} />}
        </div>
      </div>
    </div>
  );
}

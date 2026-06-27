import { useDashboardStore } from "../store";

/**
 * Item 161: dismissible onboarding checklist.
 *
 *   ✓ took the tour          (learning.tookTour)
 *   ☐ traced a request       (learning.didTrace)
 *   ☐ read a domain flow     (learning.readDomainFlow)
 *   ☐ bookmarked 3 nodes     (workspace.bookmarks.length >= 3)
 *
 * Each milestone is tracked in the localStorage learning slice (except
 * bookmarks, which come from the persisted workspace). The card is dismissible
 * and auto-hides once every item is complete.
 */
export default function OnboardingChecklist() {
  const learning = useDashboardStore((s) => s.learning);
  const startTour = useDashboardStore((s) => s.startTour);
  const bookmarks = useDashboardStore((s) => s.workspace.bookmarks);
  const dismissChecklist = useDashboardStore((s) => s.dismissChecklist);
  const setViewMode = useDashboardStore((s) => s.setViewMode);

  const bookmarkedEnough = bookmarks.length >= 3;
  const items = [
    { key: "tour", label: "Take the tour", done: learning.tookTour, action: startTour },
    {
      key: "trace",
      label: "Trace a request",
      done: learning.didTrace,
      action: () => setViewMode("trace"),
    },
    {
      key: "domain",
      label: "Read a domain flow",
      done: learning.readDomainFlow,
      action: () => setViewMode("domain"),
    },
    {
      key: "bookmark",
      label: `Bookmark 3 nodes (${Math.min(bookmarks.length, 3)}/3)`,
      done: bookmarkedEnough,
    },
  ];

  const completed = items.filter((i) => i.done).length;
  const allDone = completed === items.length;

  if (learning.checklistDismissed || allDone) return null;

  return (
    <div className="mb-5 bg-elevated rounded-lg p-3 border border-accent/25">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">
          Get started ({completed}/{items.length})
        </h3>
        <button
          type="button"
          onClick={dismissChecklist}
          className="text-text-muted hover:text-text-primary transition-colors text-xs"
          title="Dismiss checklist"
          aria-label="Dismiss onboarding checklist"
        >
          ×
        </button>
      </div>
      <div className="space-y-1.5">
        {items.map((i) => (
          <div key={i.key} className="flex items-center gap-2 text-xs">
            <span
              className={`w-4 h-4 shrink-0 rounded flex items-center justify-center text-[10px] ${
                i.done
                  ? "bg-accent/20 text-accent"
                  : "border border-border-medium text-transparent"
              }`}
              aria-hidden
            >
              ✓
            </span>
            {i.done || !i.action ? (
              <span
                className={
                  i.done ? "text-text-muted line-through" : "text-text-secondary"
                }
              >
                {i.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={i.action}
                className="text-text-secondary hover:text-accent transition-colors text-left"
              >
                {i.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

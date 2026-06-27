import { useState } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 136: "Resume where you left off" banner.
 *
 * On reload, if a tour was in progress at last unload (persisted to the
 * localStorage learning slice), offer to continue it at the saved step or
 * dismiss. Only shown once the graph + learning state are loaded and no tour
 * is currently active.
 */
export default function ResumeBanner() {
  const graph = useDashboardStore((s) => s.graph);
  const learning = useDashboardStore((s) => s.learning);
  const learningLoaded = useDashboardStore((s) => s.learningLoaded);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const resumeTour = useDashboardStore((s) => s.resumeTour);
  const stopTour = useDashboardStore((s) => s.stopTour);
  const markChecklist = useDashboardStore((s) => s.markChecklist);
  const [hidden, setHidden] = useState(false);

  const tourLen = graph?.tour?.length ?? 0;
  const show =
    !hidden &&
    learningLoaded &&
    !tourActive &&
    tourLen > 0 &&
    learning.tourInProgress &&
    learning.tourStep > 0;

  if (!show) return null;

  const stepNo = Math.min(learning.tourStep + 1, tourLen);

  return (
    <div className="px-5 py-2.5 bg-accent/10 border-b border-accent/30 flex items-center gap-3 text-sm">
      <span className="text-accent" aria-hidden>
        ↻
      </span>
      <span className="text-text-secondary flex-1">
        You were on the guided tour — <strong className="text-text-primary">step {stepNo} of {tourLen}</strong>. Pick up where you left off?
      </span>
      <button
        type="button"
        onClick={() => {
          markChecklist("tookTour");
          resumeTour();
          setHidden(true);
        }}
        className="px-3 py-1 rounded-lg bg-accent/20 text-accent text-xs font-semibold hover:bg-accent/30 transition-colors"
      >
        Resume tour →
      </button>
      <button
        type="button"
        onClick={() => {
          // stopTour persists tourInProgress:false so the banner stays gone.
          stopTour();
          setHidden(true);
        }}
        className="px-2.5 py-1 rounded-lg text-text-muted text-xs hover:text-text-primary hover:bg-elevated transition-colors"
      >
        Not now
      </button>
    </div>
  );
}

import { useDashboardStore } from "../store";
import { ALL_TRACKS, TRACK_LABELS, TRACK_HINTS } from "../utils/curriculum";

/**
 * Item 157: Role-based curriculum tracks.
 *
 * A preset-track chooser (Everything / Frontend / Backend / Data / DevOps /
 * Product) that scopes the curriculum + prerequisite graph to the relevant
 * layers / node-types. Selecting a track persists to localStorage and re-scopes
 * every teaching surface that reads `learning.curriculumTrack`.
 */
export default function TrackSelector() {
  const track = useDashboardStore((s) => s.learning.curriculumTrack);
  const setCurriculumTrack = useDashboardStore((s) => s.setCurriculumTrack);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_TRACKS.map((tr) => (
          <button
            key={tr}
            type="button"
            onClick={() => setCurriculumTrack(tr)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              track === tr
                ? "bg-accent/15 border-accent/50 text-accent"
                : "bg-elevated border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/30"
            }`}
            title={TRACK_HINTS[tr]}
          >
            {TRACK_LABELS[tr]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-text-muted mt-1.5">{TRACK_HINTS[track]}</p>
    </div>
  );
}

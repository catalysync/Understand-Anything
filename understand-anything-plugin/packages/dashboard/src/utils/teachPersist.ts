// Client-side persistence for the 200-series teaching long-tail features whose
// shapes are richer than the flat LearningState flags:
//
//   • item 163 — flashcard spaced-review state (per-card due time + box).
//   • item 172 — last-visit snapshot of node ids (+ last-commit timestamps) so
//     the next load can diff "what changed since I was last here".
//
// All keyed per project (so two graphs don't bleed) and stored in localStorage —
// the server workspace whitelist drops unknown keys, so this stays client-side.

// ---------------------------------------------------------------------------
// Flashcard spaced-review state (item 163)
// ---------------------------------------------------------------------------

export interface FlashcardReview {
  /** Leitner box 0..4 — higher = longer interval. */
  box: number;
  /** Epoch ms when this card is next due for review. */
  dueAt: number;
  /** Epoch ms of the last review (for ordering / display). */
  lastReviewedAt: number;
}

/** cardId → review state. cardId is stable: `bm:<nodeId>` or `term:<name>`. */
export type FlashcardReviews = Record<string, FlashcardReview>;

const FLASH_PREFIX = "ua-flashcards-v1";

function flashKey(projectKey: string): string {
  return `${FLASH_PREFIX}:${projectKey || "default"}`;
}

export function loadFlashcardReviews(projectKey: string): FlashcardReviews {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(flashKey(projectKey));
    if (!raw) return {};
    return JSON.parse(raw) as FlashcardReviews;
  } catch {
    return {};
  }
}

export function saveFlashcardReviews(
  projectKey: string,
  reviews: FlashcardReviews,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(flashKey(projectKey), JSON.stringify(reviews));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/** Leitner-ish interval (ms) for a box after a correct ("got it") review. */
const BOX_INTERVALS_MS = [
  1000 * 60 * 10, //  box 0 → 10 min
  1000 * 60 * 60 * 24, //  box 1 → 1 day
  1000 * 60 * 60 * 24 * 3, //  box 2 → 3 days
  1000 * 60 * 60 * 24 * 7, //  box 3 → 1 week
  1000 * 60 * 60 * 24 * 21, // box 4 → 3 weeks
];

/** Apply a review grade, returning the next review state. */
export function gradeCard(
  prev: FlashcardReview | undefined,
  correct: boolean,
): FlashcardReview {
  const now = Date.now();
  const curBox = prev?.box ?? 0;
  const box = correct
    ? Math.min(BOX_INTERVALS_MS.length - 1, curBox + 1)
    : 0;
  return {
    box,
    dueAt: now + BOX_INTERVALS_MS[box],
    lastReviewedAt: now,
  };
}

/** Is a card due now? Unreviewed cards (no entry) are always due. */
export function isCardDue(review: FlashcardReview | undefined): boolean {
  if (!review) return true;
  return review.dueAt <= Date.now();
}

// ---------------------------------------------------------------------------
// Last-visit snapshot (item 172)
// ---------------------------------------------------------------------------

export interface VisitSnapshot {
  /** Epoch ms the snapshot was taken. */
  takenAt: number;
  /** Sorted node ids present at last visit. */
  nodeIds: string[];
  /** nodeId → attrs.lastCommitAt (only for nodes that carry it). */
  commitAt: Record<string, string>;
}

const SNAP_PREFIX = "ua-lastvisit-v1";

function snapKey(projectKey: string): string {
  return `${SNAP_PREFIX}:${projectKey || "default"}`;
}

export function loadVisitSnapshot(projectKey: string): VisitSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(snapKey(projectKey));
    if (!raw) return null;
    return JSON.parse(raw) as VisitSnapshot;
  } catch {
    return null;
  }
}

export function saveVisitSnapshot(
  projectKey: string,
  snapshot: VisitSnapshot,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(snapKey(projectKey), JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

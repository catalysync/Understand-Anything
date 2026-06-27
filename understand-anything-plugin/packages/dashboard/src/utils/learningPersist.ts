// Client-side persistence for onboarding / learning state.
//
// IMPORTANT: the server's workspace whitelist (writeWorkspace in vite.config.ts)
// drops any key it doesn't recognise (version/bookmarks/annotations/sessions/
// watches/tours/rules). Onboarding goal, tour progress, visited-node coverage,
// the onboarding checklist and the "New to Go?" language axis are therefore NOT
// persisted to workspace.json — they live in localStorage instead, keyed per
// project so two different graphs don't bleed into each other.

export type OnboardingGoal =
  | "architecture"
  | "find"
  | "role"
  | "exploring";

/** 200-series item 157: preset role-based curriculum tracks. */
export type CurriculumTrack =
  | "all"
  | "frontend"
  | "backend"
  | "data"
  | "devops"
  | "pm";

export interface LearningState {
  onboardingGoal: OnboardingGoal | null;
  /** Last tour step the user reached (0-based). */
  tourStep: number;
  /** Tour step orders the user has completed (advanced past). */
  completedSteps: number[];
  /** Was a tour/exploration in progress at last unload? (resume banner) */
  tourInProgress: boolean;
  /** Node ids the user has selected / explained / traced (coverage meter). */
  visitedNodeIds: string[];
  /** "New to Go?" language axis — expand every languageLesson by default. */
  languageAxis: boolean;
  /** Has the user dismissed the onboarding checklist card? */
  checklistDismissed: boolean;
  /** Did the user take (start) the tour at least once? (checklist) */
  tookTour: boolean;
  /** Did the user run at least one trace? (checklist) */
  didTrace: boolean;
  /** Did the user open a domain flow? (checklist) */
  readDomainFlow: boolean;
  // ---- 200-series teaching long-tail (items 154/157/172) ----------------
  /** Item 154: curriculum module ids the user has marked complete. */
  completedModules: string[];
  /** Item 157: the active role-based curriculum track. */
  curriculumTrack: CurriculumTrack;
  /** Item 172: the user has dismissed the "what changed" recap for this snapshot. */
  recapDismissedFor: string | null;
}

export const EMPTY_LEARNING: LearningState = {
  onboardingGoal: null,
  tourStep: 0,
  completedSteps: [],
  tourInProgress: false,
  visitedNodeIds: [],
  languageAxis: false,
  checklistDismissed: false,
  tookTour: false,
  didTrace: false,
  readDomainFlow: false,
  completedModules: [],
  curriculumTrack: "all",
  recapDismissedFor: null,
};

const KEY_PREFIX = "ua-learning-v1";

function keyFor(projectKey: string): string {
  return `${KEY_PREFIX}:${projectKey || "default"}`;
}

export function loadLearning(projectKey: string): LearningState {
  if (typeof window === "undefined") return { ...EMPTY_LEARNING };
  try {
    const raw = window.localStorage.getItem(keyFor(projectKey));
    if (!raw) return { ...EMPTY_LEARNING };
    const parsed = JSON.parse(raw) as Partial<LearningState>;
    return { ...EMPTY_LEARNING, ...parsed };
  } catch {
    return { ...EMPTY_LEARNING };
  }
}

export function saveLearning(projectKey: string, state: LearningState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(projectKey), JSON.stringify(state));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

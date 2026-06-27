// Client-side persistence for app-wide settings + recent/pinned destinations.
//
// IMPORTANT: the server's workspace whitelist (writeWorkspace) drops any key it
// doesn't recognise, so the integration/polish settings introduced in the
// connective-tissue wave (items 187/199/200b/200c) live in localStorage instead,
// keyed per project so two different graphs don't bleed into each other.
//
// Persisted here:
//  - 187: recently-focused entities + pinned destinations (palette header)
//  - 200b: settings modal — default landing view + default trace depth/direction
//          (persona/theme/language-axis persist via their own mechanisms; the
//          modal just provides one place to set them).

import type { ViewMode } from "../store";

export interface AppSettings {
  /** 200b: the view the dashboard lands on once the graph loads. */
  defaultLandingView: ViewMode | "auto";
  /** 200b: default trace build depth (1–6). */
  defaultTraceDepth: number;
  /** 200b: default trace walk direction. */
  defaultTraceDirection: "callees" | "callers";
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultLandingView: "auto",
  defaultTraceDepth: 4,
  defaultTraceDirection: "callees",
};

/** 187: a recently-focused entity (most-recent first). */
export interface RecentEntity {
  nodeId: string;
  /** Cached display name so the chip renders before the graph resolves it. */
  name: string;
  /** Cached node type for the badge. */
  type: string;
  at: number;
}

export interface PinnedEntity {
  nodeId: string;
  name: string;
  type: string;
}

export interface DestinationsState {
  recent: RecentEntity[];
  pinned: PinnedEntity[];
}

export const EMPTY_DESTINATIONS: DestinationsState = { recent: [], pinned: [] };

const SETTINGS_PREFIX = "ua-settings-v1";
const DEST_PREFIX = "ua-destinations-v1";

const MAX_RECENT = 8;
const MAX_PINNED = 12;

function settingsKey(projectKey: string): string {
  return `${SETTINGS_PREFIX}:${projectKey || "default"}`;
}
function destKey(projectKey: string): string {
  return `${DEST_PREFIX}:${projectKey || "default"}`;
}

export function loadSettings(projectKey: string): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(settingsKey(projectKey));
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(projectKey: string, settings: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(settingsKey(projectKey), JSON.stringify(settings));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function loadDestinations(projectKey: string): DestinationsState {
  if (typeof window === "undefined") return { ...EMPTY_DESTINATIONS };
  try {
    const raw = window.localStorage.getItem(destKey(projectKey));
    if (!raw) return { ...EMPTY_DESTINATIONS };
    const parsed = JSON.parse(raw) as Partial<DestinationsState>;
    return {
      recent: Array.isArray(parsed.recent) ? parsed.recent.slice(0, MAX_RECENT) : [],
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned.slice(0, MAX_PINNED) : [],
    };
  } catch {
    return { ...EMPTY_DESTINATIONS };
  }
}

export function saveDestinations(projectKey: string, state: DestinationsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(destKey(projectKey), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Push a freshly-focused entity to the front of the recents list (de-duped). */
export function pushRecent(
  state: DestinationsState,
  entity: RecentEntity,
): DestinationsState {
  const recent = [
    entity,
    ...state.recent.filter((r) => r.nodeId !== entity.nodeId),
  ].slice(0, MAX_RECENT);
  return { ...state, recent };
}

/** Toggle a pinned destination on/off. */
export function togglePinned(
  state: DestinationsState,
  entity: PinnedEntity,
): DestinationsState {
  const exists = state.pinned.some((p) => p.nodeId === entity.nodeId);
  const pinned = exists
    ? state.pinned.filter((p) => p.nodeId !== entity.nodeId)
    : [...state.pinned, entity].slice(0, MAX_PINNED);
  return { ...state, pinned };
}

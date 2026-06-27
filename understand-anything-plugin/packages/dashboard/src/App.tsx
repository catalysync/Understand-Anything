import { useEffect, useState, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue } from "@understand-anything/core/schema";
import { useDashboardStore, setWorkspaceToken } from "./store";
import type { Workspace, ViewMode } from "./store";
import GraphView from "./components/GraphView";
import DomainGraphView from "./components/DomainGraphView";
import KnowledgeGraphView from "./components/KnowledgeGraphView";
import SearchBar from "./components/SearchBar";
import LayerLegend from "./components/LayerLegend";
import DiffToggle from "./components/DiffToggle";
import FilterPanel from "./components/FilterPanel";
import ExportMenu from "./components/ExportMenu";
import PersonaSelector from "./components/PersonaSelector";
import SidebarInspector from "./components/SidebarInspector";
import WarningBanner from "./components/WarningBanner";
import TokenGate from "./components/TokenGate";
import BookmarksPanel from "./components/BookmarksPanel";
import JumpActions from "./components/JumpActions";
import StartHereSpotlight from "./components/StartHereSpotlight";
import ResumeBanner from "./components/ResumeBanner";
import LanguageAxisToggle from "./components/LanguageAxisToggle";
import WhatChangedPanel from "./components/WhatChangedPanel";
import ViewState from "./components/ViewState";
import MobileLayout from "./components/MobileLayout";
import { useIsMobile } from "./hooks/useIsMobile";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { KeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { ThemeProvider } from "./themes/index.ts";
import { ThemePicker } from "./components/ThemePicker.tsx";
import type { ThemeConfig } from "./themes/index.ts";
import { I18nProvider, useI18n } from "./contexts/I18nContext.tsx";

// Lazy-load heavy / optional components so they ship in separate chunks.
const CodeViewer = lazy(() => import("./components/CodeViewer"));
const TraceView = lazy(() => import("./components/TraceView"));
const DataView = lazy(() => import("./components/DataView"));
const PathFinderModal = lazy(() => import("./components/PathFinderModal"));
const KeyboardShortcutsHelp = lazy(
  () => import("./components/KeyboardShortcutsHelp"),
);
const OnboardingOverlay = lazy(() => import("./components/OnboardingOverlay"));
const SymbolPalette = lazy(() => import("./components/SymbolPalette"));
const SettingsModal = lazy(() => import("./components/SettingsModal"));

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const SESSION_TOKEN_KEY = "understand-anything-token";
const ONBOARDING_DISMISSED_KEY = "ua-onboarding-dismissed-v1";

// Layout ergonomics: resizable left sidebar (drag splitter) persisted to
// localStorage (the server workspace whitelist drops unknown keys).
const SIDEBAR_WIDTH_KEY = "ua-sidebar-width-v1";
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 640;
const SIDEBAR_DEFAULT_WIDTH = 360;

function readSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, n));
    }
  } catch {
    /* ignore */
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

function persistSidebarWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* ignore */
  }
}

function shouldShowOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("onboard") === "force") return true;
  return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== "1";
}

/** Resolve data file URL — in demo mode, use env var URLs; otherwise use local paths with token. */
function dataUrl(fileName: string, token: string | null): string {
  if (DEMO_MODE) {
    const envMap: Record<string, string | undefined> = {
      "knowledge-graph.json": import.meta.env.VITE_GRAPH_URL,
      "domain-graph.json": import.meta.env.VITE_DOMAIN_GRAPH_URL,
      "meta.json": import.meta.env.VITE_META_URL,
      "diff-overlay.json": import.meta.env.VITE_DIFF_OVERLAY_URL,
      "config.json": import.meta.env.VITE_CONFIG_URL,
    };
    const url = envMap[fileName];
    if (url) return url;
    const base = import.meta.env.BASE_URL || "/";
    return `${base.endsWith("/") ? base : `${base}/`}${fileName}`;
  }
  const path = `/${fileName}`;
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

/**
 * Resolve the access token from the URL query string or sessionStorage.
 * If found in the URL, persist to sessionStorage and strip the param from the address bar.
 */
function resolveInitialToken(): string | null {
  if (DEMO_MODE) return "__demo__";
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, urlToken);
    // Clean the URL
    params.delete("token");
    const cleanSearch = params.toString();
    const newUrl =
      window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
    return urlToken;
  }
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

function App() {
  const [accessToken, setAccessToken] = useState<string | null>(resolveInitialToken);

  const handleTokenValid = useCallback((token: string) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    setAccessToken(token);
  }, []);

  // In demo mode, skip token gate entirely
  if (DEMO_MODE) {
    return <Dashboard accessToken="__demo__" />;
  }

  // Show the token gate when no token is available
  if (accessToken === null) {
    return <TokenGate onTokenValid={handleTokenValid} />;
  }

  return <Dashboard accessToken={accessToken} />;
}

function Dashboard({ accessToken }: { accessToken: string }) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setDiffOverlay = useDashboardStore((s) => s.setDiffOverlay);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [metaTheme, setMetaTheme] = useState<ThemeConfig | null>(null);
  const [outputLanguage, setOutputLanguage] = useState<string | undefined>();

  const loadWorkspace = useDashboardStore((s) => s.loadWorkspace);

  // Load persisted workspace (bookmarks, annotations, node→session map, …)
  // and register the token used for debounced POST persistence.
  useEffect(() => {
    setWorkspaceToken(accessToken);
    if (accessToken === "__demo__") return;
    fetch(dataUrl("workspace.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((ws) => {
        if (ws && typeof ws === "object") loadWorkspace(ws as Workspace);
      })
      .catch(() => {});
  }, [accessToken, loadWorkspace]);

  useEffect(() => {
    fetch(dataUrl("meta.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (meta?.theme) setMetaTheme(meta.theme);
      })
      .catch(() => {});
    fetch(dataUrl("config.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((config) => {
        if (config?.outputLanguage) setOutputLanguage(config.outputLanguage);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(dataUrl("knowledge-graph.json", accessToken))
      .then((res) => res.json())
      .then((data: unknown) => {
        const result = validateGraph(data);
        if (result.success && result.data) {
          setGraph(result.data);
          // Items 131-165: hydrate per-project onboarding/learning state from
          // localStorage (workspace whitelist drops these keys, so they live
          // client-side). Keyed by project name + git hash for stability.
          const proj = result.data.project;
          useDashboardStore
            .getState()
            .loadLearning(`${proj.name}@${proj.gitCommitHash || ""}`);
          setGraphIssues(result.issues);
          if ((data as Record<string, unknown>).kind === "knowledge") {
            useDashboardStore.getState().setViewMode("knowledge");
            useDashboardStore.getState().setIsKnowledgeGraph(true);
          }
          for (const issue of result.issues) {
            if (issue.level === "auto-corrected") {
              console.warn(`[graph] auto-corrected: ${issue.message}`);
            } else if (issue.level === "dropped") {
              console.error(`[graph] dropped: ${issue.message}`);
            }
          }
        } else if (result.fatal) {
          console.error("Knowledge graph validation failed:", result.fatal);
          setLoadError(`Invalid knowledge graph: ${result.fatal}`);
        } else {
          console.error("Knowledge graph validation failed: unknown error");
          setLoadError("Invalid knowledge graph: unknown validation error");
        }
      })
      .catch((err) => {
        console.error("Failed to load knowledge graph:", err);
        setLoadError(`Failed to load knowledge graph: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [setGraph]);

  useEffect(() => {
    fetch(dataUrl("diff-overlay.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "changedNodeIds" in data &&
          "affectedNodeIds" in data &&
          Array.isArray((data as Record<string, unknown>).changedNodeIds) &&
          Array.isArray((data as Record<string, unknown>).affectedNodeIds)
        ) {
          const d = data as { changedNodeIds: string[]; affectedNodeIds: string[] };
          if (d.changedNodeIds.length > 0) {
            setDiffOverlay(d.changedNodeIds, d.affectedNodeIds);
          }
        }
      })
      .catch(() => {});
  }, [setDiffOverlay]);

  useEffect(() => {
    fetch(dataUrl("domain-graph.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (!data) return;
        const result = validateGraph(data);
        if (result.success && result.data) {
          setDomainGraph(result.data);
        } else if (result.fatal) {
          console.warn(`[domain-graph] validation failed: ${result.fatal}`);
        }
      })
      .catch(() => {});
  }, [setDomainGraph]);

  return (
    <I18nProvider language={outputLanguage ?? "en"}>
      <ThemeProvider metaTheme={metaTheme}>
        <DashboardContent
          accessToken={accessToken}
          loadError={loadError}
          graphIssues={graphIssues}
        />
      </ThemeProvider>
    </I18nProvider>
  );
}

function DashboardContent({
  accessToken,
  loadError,
  graphIssues,
}: {
  accessToken: string;
  loadError: string | null;
  graphIssues: GraphIssue[];
}) {
  const graph = useDashboardStore((s) => s.graph);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const codeViewerExpanded = useDashboardStore((s) => s.codeViewerExpanded);
  const expandCodeViewer = useDashboardStore((s) => s.expandCodeViewer);
  const collapseCodeViewer = useDashboardStore((s) => s.collapseCodeViewer);
  const pathFinderOpen = useDashboardStore((s) => s.pathFinderOpen);
  const togglePathFinder = useDashboardStore((s) => s.togglePathFinder);
  const nodeTypeFilters = useDashboardStore((s) => s.nodeTypeFilters);
  const toggleNodeTypeFilter = useDashboardStore((s) => s.toggleNodeTypeFilter);
  const detailLevel = useDashboardStore((s) => s.detailLevel);
  const setDetailLevel = useDashboardStore((s) => s.setDetailLevel);
  const showFunctionsInClassView = useDashboardStore((s) => s.showFunctionsInClassView);
  const toggleShowFunctionsInClassView = useDashboardStore((s) => s.toggleShowFunctionsInClassView);
  // Structural-view options (items 46/47/48/83).
  const structuralLayout = useDashboardStore((s) => s.structuralLayout);
  const setStructuralLayout = useDashboardStore((s) => s.setStructuralLayout);
  const structuralDirection = useDashboardStore((s) => s.structuralDirection);
  const toggleStructuralDirection = useDashboardStore((s) => s.toggleStructuralDirection);
  const declutterLeaves = useDashboardStore((s) => s.declutterLeaves);
  const toggleDeclutterLeaves = useDashboardStore((s) => s.toggleDeclutterLeaves);
  const complexityHeat = useDashboardStore((s) => s.complexityHeat);
  const toggleComplexityHeat = useDashboardStore((s) => s.toggleComplexityHeat);
  const coverageOverlay = useDashboardStore((s) => s.coverageOverlay);
  const toggleCoverageOverlay = useDashboardStore((s) => s.toggleCoverageOverlay);
  const instrumentationHeat = useDashboardStore((s) => s.instrumentationHeat);
  const toggleInstrumentationHeat = useDashboardStore((s) => s.toggleInstrumentationHeat);
  const swallowedMarkers = useDashboardStore((s) => s.swallowedMarkers);
  const toggleSwallowedMarkers = useDashboardStore((s) => s.toggleSwallowedMarkers);
  // 300-series items 27/48/51/108: git-metadata overlays.
  const ownershipOverlay = useDashboardStore((s) => s.ownershipOverlay);
  const setOwnershipOverlay = useDashboardStore((s) => s.setOwnershipOverlay);
  const cyclesOverlay = useDashboardStore((s) => s.cyclesOverlay);
  const toggleCyclesOverlay = useDashboardStore((s) => s.toggleCyclesOverlay);
  const resilienceBadges = useDashboardStore((s) => s.resilienceBadges);
  const toggleResilienceBadges = useDashboardStore((s) => s.toggleResilienceBadges);
  const hotspotPanelOpen = useDashboardStore((s) => s.hotspotPanelOpen);
  const toggleHotspotPanel = useDashboardStore((s) => s.toggleHotspotPanel);
  // 300-series items 9-10/21/22/25/26: architecture & API-surface tier.
  const archPanelOpen = useDashboardStore((s) => s.archPanelOpen);
  const toggleArchPanel = useDashboardStore((s) => s.toggleArchPanel);
  const boundaryOverlay = useDashboardStore((s) => s.boundaryOverlay);
  const publicSurfaceOnly = useDashboardStore((s) => s.publicSurfaceOnly);
  const togglePublicSurfaceOnly = useDashboardStore((s) => s.togglePublicSurfaceOnly);
  const c4Level = useDashboardStore((s) => s.c4Level);
  const setC4Level = useDashboardStore((s) => s.setC4Level);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth);
  const resizingRef = useRef(false);
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);
  const dismissOnboarding = useCallback((remember: boolean) => {
    if (remember && typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    }
    setShowOnboarding(false);
  }, []);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const onboardingGoal = useDashboardStore((s) => s.learning.onboardingGoal);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const layoutIssues = useDashboardStore((s) => s.layoutIssues);
  const settings = useDashboardStore((s) => s.settings);
  const learningLoaded = useDashboardStore((s) => s.learningLoaded);
  const ariaAnnouncement = useDashboardStore((s) => s.ariaAnnouncement);
  const setSettingsModalOpen = useDashboardStore((s) => s.setSettingsModalOpen);
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const allIssues = useMemo(
    () => [...graphIssues, ...layoutIssues],
    [graphIssues, layoutIssues],
  );

  // Resizable sidebar drag handlers (pointer-based; clamped + persisted).
  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      // Sidebar is on the right edge — width grows as the pointer moves left.
      const next = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - ev.clientX),
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      resizingRef.current = false;
      setSidebarWidth((w) => {
        persistSidebarWidth(w);
        return w;
      });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    persistSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }, []);

  // Item 132: route the initial view from the "Pick your goal" card. Fires only
  // when the goal actually changes (the overlay sets it on dismiss).
  const lastRoutedGoal = useRef<string | null>(null);
  useEffect(() => {
    if (!graph || !onboardingGoal) return;
    if (lastRoutedGoal.current === onboardingGoal) return;
    lastRoutedGoal.current = onboardingGoal;
    const store = useDashboardStore.getState();
    switch (onboardingGoal) {
      case "architecture":
        store.setViewMode("structural", { keepSelection: false });
        store.navigateToOverview();
        break;
      case "find":
        store.setViewMode("structural", { keepSelection: false });
        // Defer so the input is mounted before we focus it.
        setTimeout(() => {
          document
            .querySelector<HTMLInputElement>('[data-testid="search-input"]')
            ?.focus();
        }, 120);
        break;
      case "role":
        store.startTour();
        break;
      case "exploring":
        store.setViewMode("structural", { keepSelection: false });
        store.selectNode(null);
        break;
    }
  }, [graph, onboardingGoal]);

  // Item 200b: apply the persisted default landing view once, when the graph +
  // settings are ready and no onboarding goal is steering the initial view.
  const appliedLanding = useRef(false);
  useEffect(() => {
    if (appliedLanding.current) return;
    if (!graph || !learningLoaded || isKnowledgeGraph) return;
    if (onboardingGoal) {
      // The goal-routing effect owns the initial view; don't fight it.
      appliedLanding.current = true;
      return;
    }
    const target = settings.defaultLandingView;
    if (target && target !== "auto") {
      if (target === "domain" && !domainGraph) {
        appliedLanding.current = true;
        return;
      }
      useDashboardStore.getState().setViewMode(target, { keepSelection: false });
    }
    appliedLanding.current = true;
  }, [graph, learningLoaded, isKnowledgeGraph, onboardingGoal, settings.defaultLandingView, domainGraph]);

  // Define keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      // Help
      {
        key: "?",
        shiftKey: true,
        description: t.keyboardShortcuts.showHelp,
        action: () => setShowKeyboardHelp((prev) => !prev),
        category: "General",
      },
      // Navigation
      {
        key: "Escape",
        description: t.keyboardShortcuts.escapeDesc,
        action: () => {
          // Read from store at invocation time to avoid stale closures
          const state = useDashboardStore.getState();
          if (state.symbolPaletteOpen) {
            state.setSymbolPaletteOpen(false);
          } else if (state.pathFinderOpen) {
            state.togglePathFinder();
          } else if (state.filterPanelOpen) {
            state.toggleFilterPanel();
          } else if (state.exportMenuOpen) {
            state.toggleExportMenu();
          } else if (state.codeViewerExpanded) {
            state.collapseCodeViewer();
          } else if (state.codeViewerOpen) {
            state.closeCodeViewer();
          } else if (state.selectedNodeId) {
            state.selectNode(null);
          } else if (state.navigationLevel === "layer-detail") {
            state.navigateToOverview();
          } else if (state.tourActive) {
            state.stopTour();
          } else {
            setShowKeyboardHelp(false);
          }
        },
        category: "Navigation",
      },
      {
        key: "/",
        description: t.keyboardShortcuts.focusSearch,
        action: () => {
          const searchInput = document.querySelector<HTMLInputElement>(
            '[data-testid="search-input"]'
          );
          searchInput?.focus();
        },
        category: "Navigation",
      },
      // Tour controls
      {
        key: "ArrowRight",
        description: t.keyboardShortcuts.nextStep,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.nextTourStep();
          }
        },
        category: "Tour",
      },
      {
        key: "ArrowLeft",
        description: t.keyboardShortcuts.prevStep,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.prevTourStep();
          }
        },
        category: "Tour",
      },
      // View toggles
      {
        key: "d",
        description: t.keyboardShortcuts.toggleDiff,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleDiffMode();
        },
        category: "View",
      },
      {
        key: "f",
        description: t.keyboardShortcuts.toggleFilter,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleFilterPanel();
        },
        category: "View",
      },
      {
        key: "e",
        description: t.keyboardShortcuts.toggleExport,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleExportMenu();
        },
        category: "View",
      },
      {
        key: "p",
        description: t.keyboardShortcuts.openPathFinder,
        action: () => {
          const state = useDashboardStore.getState();
          state.togglePathFinder();
        },
        category: "View",
      },
      // Wave-2 feature 20: fuzzy symbol palette (⌘K / Ctrl+K and ⌘P / Ctrl+P).
      {
        key: "k",
        metaKey: true,
        description: "Open symbol palette",
        action: () => useDashboardStore.getState().toggleSymbolPalette(),
        category: "Navigation",
      },
      {
        key: "k",
        ctrlKey: true,
        description: "Open symbol palette",
        action: () => useDashboardStore.getState().toggleSymbolPalette(),
        category: "Navigation",
      },
      {
        key: "p",
        metaKey: true,
        description: "Open symbol palette",
        action: () => useDashboardStore.getState().toggleSymbolPalette(),
        category: "Navigation",
      },
      // Item 200c: cross-view jump shortcuts.
      {
        key: "t",
        description: "Trace focused node (or open Trace view)",
        action: () => {
          const state = useDashboardStore.getState();
          if (state.selectedNodeId) state.startTraceAt(state.selectedNodeId);
          else state.setViewMode("trace");
        },
        category: "Navigation",
      },
      {
        key: "g",
        description: "Go to the structural graph",
        action: () => {
          const state = useDashboardStore.getState();
          if (state.selectedNodeId)
            state.focusEntity(state.selectedNodeId, { view: "structural" });
          else state.setViewMode("structural");
        },
        category: "Navigation",
      },
      {
        key: ",",
        metaKey: true,
        description: "Open settings",
        action: () => useDashboardStore.getState().setSettingsModalOpen(true),
        category: "General",
      },
    ],
    [t]
  );

  // Register keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  if (isMobile) {
    return (
      <MobileLayout
        accessToken={accessToken}
        showKeyboardHelp={showKeyboardHelp}
        setShowKeyboardHelp={setShowKeyboardHelp}
        loadError={loadError}
        allIssues={allIssues}
        shortcuts={shortcuts}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-root text-text-primary noise-overlay">
      {/* Header */}
      <header className="flex items-center px-3 sm:px-5 py-3 bg-surface border-b border-border-subtle shrink-0 gap-2 sm:gap-4">
        {/* Left — fixed */}
        <div className="flex items-center gap-3 sm:gap-5 shrink-0 min-w-0">
          <h1 className="font-heading text-base sm:text-lg text-text-primary tracking-wide truncate max-w-[160px] sm:max-w-[220px] lg:max-w-none">
            {graph?.project.name ?? t.common.appName}
          </h1>
          <div className="w-px h-5 bg-border-subtle hidden sm:block" />
          <PersonaSelector />
          {/* Item 149: "New to <Language>?" axis (self-hides if no lessons). */}
          <LanguageAxisToggle />
          {graph && !isKnowledgeGraph && (
            <>
              <div className="w-px h-5 bg-border-subtle" />
              <div className="flex items-center bg-elevated rounded-lg p-0.5">
                {domainGraph && (
                  <button
                    type="button"
                    onClick={() => setViewMode("domain")}
                    title={t.drawer.domain}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      viewMode === "domain"
                        ? "bg-accent/20 text-accent"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {t.drawer.domain}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewMode("structural")}
                  title={t.drawer.structural}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "structural"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {t.drawer.structural}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("trace")}
                  title="Flow / Trace — follow the call chain from a node"
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "trace"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Trace
                </button>
                {/* 300-series items 61-64: Data / ERD view */}
                <button
                  type="button"
                  onClick={() => setViewMode("data")}
                  title="Data / ERD — tables, columns and foreign keys"
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "data"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Data
                </button>
              </div>
            </>
          )}
        </div>

        {/* Middle — scrollable legends */}
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-4 w-max">
            <DiffToggle />
            {/* Item 197: "What changed" cross-view summary (shows only in diff mode). */}
            <WhatChangedPanel />
            {/* Detail level: file view (architecture) / class view (code structure) */}
            {!isKnowledgeGraph && viewMode !== "domain" && viewMode !== "data" && (
              <>
                <div className="w-px h-5 bg-border-subtle" />
                <div className="flex items-center bg-elevated rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setDetailLevel("file")}
                    title={t.detailLevel.filesTitle}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      detailLevel === "file"
                        ? "bg-accent/20 text-accent"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {t.detailLevel.files}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailLevel("class")}
                    title={t.detailLevel.classesTitle}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      detailLevel === "class"
                        ? "bg-accent/20 text-accent"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {t.detailLevel.classes}
                  </button>
                </div>
                {detailLevel === "class" && (
                  <button
                    type="button"
                    onClick={toggleShowFunctionsInClassView}
                    title={t.detailLevel.fnTitle}
                    className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                      showFunctionsInClassView
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                        : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {t.detailLevel.fn}
                  </button>
                )}
              </>
            )}

            {/* Structural layout / direction / declutter / heat controls
                (items 46/47/48/83). Only relevant in the structural graph view. */}
            {!isKnowledgeGraph && viewMode === "structural" && (
              <>
                <div className="w-px h-5 bg-border-subtle" />
                {/* 46: layered vs force */}
                <div className="flex items-center bg-elevated rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setStructuralLayout("layered")}
                    title="Layered (hierarchical) layout"
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      structuralLayout === "layered"
                        ? "bg-accent/20 text-accent"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    Layered
                  </button>
                  <button
                    type="button"
                    onClick={() => setStructuralLayout("force")}
                    title="Force-directed layout"
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      structuralLayout === "force"
                        ? "bg-accent/20 text-accent"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    Force
                  </button>
                </div>
                {/* 47: TB ⇄ LR direction (only meaningful for layered) */}
                {structuralLayout === "layered" && (
                  <button
                    type="button"
                    onClick={toggleStructuralDirection}
                    title="Toggle layout direction (top-to-bottom ⇄ left-to-right)"
                    className="text-[11px] font-semibold px-2 py-1 rounded border border-border-medium bg-elevated text-text-secondary hover:text-text-primary transition-colors"
                  >
                    {structuralDirection === "DOWN" ? "↓ TB" : "→ LR"}
                  </button>
                )}
                {/* 48: declutter */}
                <button
                  type="button"
                  onClick={toggleDeclutterLeaves}
                  title="Declutter — hide low-connectivity leaf nodes"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    declutterLeaves
                      ? "border-gold/50 bg-gold/10 text-gold"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Declutter
                </button>
                {/* 83: complexity heat */}
                <button
                  type="button"
                  onClick={toggleComplexityHeat}
                  title="Complexity heat — recolor nodes green→amber→red by complexity"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    complexityHeat
                      ? "border-[#c97070]/50 bg-[#c97070]/10 text-[#c97070]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Heat
                </button>
                {/* 300-series item 39: tri-state coverage overlay */}
                <button
                  type="button"
                  onClick={toggleCoverageOverlay}
                  title="Coverage overlay — paint nodes covered (green) / partial (yellow) / uncovered (red)"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    coverageOverlay
                      ? "border-[#5a9e6f]/50 bg-[#5a9e6f]/10 text-[#5a9e6f]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Coverage
                </button>
                {/* 300-series item 99/101-102: instrumentation heat overlay */}
                <button
                  type="button"
                  onClick={toggleInstrumentationHeat}
                  title="Instrumentation heat — green = emits logs/spans/metrics, amber = reachable but telemetry-less, red = telemetry-dark"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    instrumentationHeat
                      ? "border-[#a78bda]/50 bg-[#a78bda]/10 text-[#a78bda]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Telemetry
                </button>
                {/* 300-series item 95: swallowed-error markers */}
                <button
                  type="button"
                  onClick={toggleSwallowedMarkers}
                  title="Swallowed-error markers — badge nodes with an empty / log-only / broad catch"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    swallowedMarkers
                      ? "border-[#d4a574]/50 bg-[#d4a574]/10 text-[#d4a574]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  ⚠ Swallowed
                </button>
                {/* 300-series item 51: ownership / bus-factor overlay (cycles off→owner→single-owner) */}
                <button
                  type="button"
                  onClick={() =>
                    setOwnershipOverlay(
                      ownershipOverlay === "off" ? "owner" : ownershipOverlay === "owner" ? "single-owner" : "off",
                    )
                  }
                  title="Ownership overlay — cycle: off → color by owner → flag single-owner complex hotspots"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    ownershipOverlay !== "off"
                      ? "border-[#7da7d4]/50 bg-[#7da7d4]/10 text-[#7da7d4]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  👤 {ownershipOverlay === "single-owner" ? "Bus factor" : "Owners"}
                </button>
                {/* 300-series item 27: circular-dependency overlay */}
                <button
                  type="button"
                  onClick={toggleCyclesOverlay}
                  title="Circular-dependency detector — highlight import-cycle nodes/edges in red"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    cyclesOverlay
                      ? "border-[#d35d6e]/50 bg-[#d35d6e]/10 text-[#d35d6e]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  ⟲ Cycles
                </button>
                {/* 300-series item 108: resilience badges on calls edges */}
                <button
                  type="button"
                  onClick={toggleResilienceBadges}
                  title="Resilience badges — stamp ↻ retry / ⊘ breaker / ⏱ timeout glyphs on guarded calls edges"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    resilienceBadges
                      ? "border-[#5a9e6f]/50 bg-[#5a9e6f]/10 text-[#5a9e6f]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  ↻ Resilience
                </button>
                {/* 300-series item 48: churn × complexity hotspot quadrant panel */}
                <button
                  type="button"
                  onClick={toggleHotspotPanel}
                  title="Churn × complexity hotspot quadrant — refactor-priority scatter"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    hotspotPanelOpen
                      ? "border-[#c97070]/50 bg-[#c97070]/10 text-[#c97070]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  ▦ Hotspots
                </button>
                {/* 300-series item 25: C4 zoom level (System → Layer → File) */}
                <div className="flex items-center rounded border border-border-medium overflow-hidden">
                  {([
                    { id: "system" as const, label: "System" },
                    { id: "layer" as const, label: "Layer" },
                    { id: "file" as const, label: "File" },
                  ]).map((lvl) => (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => {
                        setC4Level(lvl.id);
                        if (lvl.id === "system") {
                          useDashboardStore.getState().navigateToOverview();
                        }
                      }}
                      title={`C4 boundary level — ${lvl.label}`}
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 transition-colors ${
                        c4Level === lvl.id
                          ? "bg-accent/15 text-accent"
                          : "bg-elevated text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                {/* 300-series item 21: public-surface-only filter */}
                <button
                  type="button"
                  onClick={togglePublicSurfaceOnly}
                  title="Public surface only — collapse internal code nodes; badge public ones"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    publicSurfaceOnly
                      ? "border-[#7da7d4]/50 bg-[#7da7d4]/10 text-[#7da7d4]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  ◑ Public
                </button>
                {/* 300-series items 9-10/22/26: architecture & API-surface panel */}
                <button
                  type="button"
                  onClick={toggleArchPanel}
                  title="Architecture panel — boundary rules / event bus / public API surface"
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                    archPanelOpen || boundaryOverlay
                      ? "border-[#d35d6e]/50 bg-[#d35d6e]/10 text-[#d35d6e]"
                      : "border-border-medium bg-elevated text-text-muted hover:text-text-secondary"
                  }`}
                >
                  ⊞ Architecture
                </button>
              </>
            )}
            <div className="flex items-center gap-1">
              {(isKnowledgeGraph ? [
                { key: "knowledge" as const, label: t.nodeTypeLabels.all, color: "var(--color-node-article)" },
              ] : [
                { key: "code" as const, label: t.nodeTypeLabels.code, color: "var(--color-node-file)" },
                { key: "config" as const, label: t.nodeTypeLabels.config, color: "var(--color-node-config)" },
                { key: "docs" as const, label: t.nodeTypeLabels.docs, color: "var(--color-node-document)" },
                { key: "infra" as const, label: t.nodeTypeLabels.infra, color: "var(--color-node-service)" },
                { key: "data" as const, label: t.nodeTypeLabels.data, color: "var(--color-node-table)" },
                { key: "domain" as const, label: t.nodeTypeLabels.domain, color: "var(--color-node-concept)" },
                { key: "knowledge" as const, label: t.nodeTypeLabels.knowledge, color: "var(--color-node-article)" },
              ]).map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => toggleNodeTypeFilter(cat.key)}
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    nodeTypeFilters[cat.key] !== false
                      ? "border-border-medium bg-elevated text-text-secondary hover:text-text-primary"
                      : "border-transparent bg-transparent text-text-muted/40 line-through hover:text-text-muted"
                  }`}
                  title={`${nodeTypeFilters[cat.key] !== false ? "Hide" : "Show"} ${cat.label} nodes`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: cat.color,
                      opacity: nodeTypeFilters[cat.key] !== false ? 1 : 0.3,
                    }}
                  />
                  {cat.label}
                </button>
              ))}
            </div>
            <LayerLegend />
          </div>
        </div>

        {/* Right — fixed actions */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <FilterPanel />
          <ExportMenu />
          <button
            onClick={() => useDashboardStore.getState().toggleSymbolPalette()}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            title="Symbol palette (⌘K)"
            data-testid="open-symbol-palette"
          >
            <span className="font-mono text-xs">⌘K</span>
            <span className="hidden md:inline">Symbols</span>
          </button>
          <button
            onClick={togglePathFinder}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            title={t.pathFinder.title}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            <span className="hidden md:inline">{t.common.path}</span>
          </button>
          <ThemePicker />
          {/* Item 200b: Settings modal entry point. */}
          <button
            onClick={() => setSettingsModalOpen(true)}
            className="text-text-muted hover:text-accent transition-colors"
            title="Settings (⌘,)"
            data-testid="open-settings"
            aria-label="Open settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={() => setShowKeyboardHelp(true)}
            className="text-text-muted hover:text-accent transition-colors"
            title={t.keyboardShortcuts.showHelp}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Search */}
      <SearchBar />

      {/* Item 136: "Resume where you left off" tour banner. */}
      <ResumeBanner />

      {/* Validation warning banner */}
      {allIssues.length > 0 && !loadError && (
        <WarningBanner issues={allIssues} />
      )}

      {/* Error banner */}
      {loadError && (
        <div className="px-5 py-3 bg-red-900/30 border-b border-red-700 text-red-200 text-sm">
          {loadError}
        </div>
      )}

      {/* Main content: Graph + Sidebar */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Graph area */}
        <div className="flex-1 min-w-0 min-h-0 relative">
          {!graph && !loadError ? (
            <ViewState kind="loading" message="Loading the knowledge graph…" />
          ) : viewMode === "trace" ? (
            <Suspense fallback={null}>
              <TraceView accessToken={accessToken} />
            </Suspense>
          ) : viewMode === "data" ? (
            <Suspense fallback={null}>
              <DataView />
            </Suspense>
          ) : viewMode === "knowledge" ? (
            <KnowledgeGraphView />
          ) : viewMode === "domain" && domainGraph ? (
            <DomainGraphView />
          ) : viewMode === "domain" && !domainGraph ? (
            <ViewState
              kind="empty"
              title="No domain graph yet"
              message="Run /understand-domain to extract business flows for this project, then reload."
              onRetry={() => setViewMode("structural")}
              retryLabel="Back to structural"
            />
          ) : (
            <GraphView />
          )}
          <div className="absolute top-3 right-3 text-sm text-text-muted/60 pointer-events-none select-none">
            {t.common.pressKeyboard}
          </div>
          {/* Item 133: "Start here" entry-point spotlight (structural view only). */}
          <StartHereSpotlight />
        </div>

        {/* Drag splitter — resize the sidebar; double-click resets to default. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startSidebarResize}
          onDoubleClick={resetSidebarWidth}
          className="w-1.5 shrink-0 cursor-col-resize bg-border-subtle/40 hover:bg-accent/40 active:bg-accent/60 transition-colors"
          title="Drag to resize · double-click to reset"
        />

        {/* Right sidebar — resizable (drag the splitter on its left edge) */}
        <aside
          className="shrink-0 bg-surface border-l border-border-subtle overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <SidebarInspector />
        </aside>

        {/* Code viewer slide-up overlay (collapsed state) */}
        {codeViewerOpen && !codeViewerExpanded && (
          <div className="absolute bottom-0 left-0 right-0 h-[40vh] bg-surface border-t border-border-subtle animate-slide-up z-20 overflow-hidden">
            <Suspense fallback={null}>
              <CodeViewer accessToken={accessToken} onExpand={expandCodeViewer} />
            </Suspense>
          </div>
        )}

        {/* Bookmarks / Investigation side panel (persisted workspace) */}
        <BookmarksPanel />
      </div>

      {/* Expanded code viewer modal */}
      {codeViewerOpen && codeViewerExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 sm:p-6"
          onMouseDown={collapseCodeViewer}
        >
          <div
            className="w-[calc(100vw-32px)] max-w-[1120px] h-[calc(100vh-32px)] sm:h-[calc(100vh-48px)] max-h-[820px] rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={null}>
              <CodeViewer
                accessToken={accessToken}
                presentation="modal"
                onClose={collapseCodeViewer}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts help modal */}
      {showKeyboardHelp && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp
            shortcuts={shortcuts}
            onClose={() => setShowKeyboardHelp(false)}
          />
        </Suspense>
      )}

      {/* Path Finder Modal — only mounted when open so its chunk is lazy-loaded on demand. */}
      {pathFinderOpen && (
        <Suspense fallback={null}>
          <PathFinderModal isOpen={pathFinderOpen} onClose={togglePathFinder} />
        </Suspense>
      )}

      {/* First-visit onboarding overlay — only mounted when needed so its chunk is lazy-loaded on demand. */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingOverlay onDismiss={dismissOnboarding} />
        </Suspense>
      )}

      {/* Wave-2 feature 20: fuzzy symbol palette (⌘K / ⌘P). Always mounted so the
          shortcut can open it; it self-hides when closed. */}
      <Suspense fallback={null}>
        <SymbolPalette />
      </Suspense>

      {/* Item 200b: consolidated Settings modal (persona/theme/landing/trace defaults). */}
      <Suspense fallback={null}>
        <SettingsModal />
      </Suspense>

      {/* K3: shared node context menu (Trace · Explain · Show-in-domain · …). */}
      <JumpActions />

      {/* Item 200c: ARIA live region announcing view / selection changes. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="aria-live"
      >
        {ariaAnnouncement}
      </div>
    </div>
  );
}

export default App;

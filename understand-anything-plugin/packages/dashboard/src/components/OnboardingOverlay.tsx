import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import type { OnboardingGoal } from "../store";

/**
 * First-visit onboarding overlay (controlled).
 *
 * Items 131 + 132:
 *   131 — cards are generated from the LOADED graph (project name, node/edge
 *         counts, top layer, languages) instead of static i18n copy.
 *   132 — a final "Pick your goal" card routes the user into the right initial
 *         view by setting store.onboardingGoal (App.tsx reacts to it).
 *
 * Parent owns visibility + persistence (see App.tsx). This component reports
 * intent via onDismiss:
 *   - onDismiss(true)  → "Skip" / Finish — parent should persist.
 *   - onDismiss(false) → backdrop click / Escape — close without persisting.
 */

interface Props {
  onDismiss: (remember: boolean) => void;
}

const TITLE_ID = "ua-onboarding-title";

interface Card {
  tag: string;
  title: string;
  body: string;
  hint?: string;
}

interface GoalOption {
  id: OnboardingGoal;
  label: string;
  desc: string;
  icon: string;
}

const GOALS: GoalOption[] = [
  {
    id: "architecture",
    label: "Understand the architecture",
    desc: "Start in the layered structural map of the whole system.",
    icon: "◫",
  },
  {
    id: "find",
    label: "Find where X lives",
    desc: "Jump straight into search to locate a file, type or symbol.",
    icon: "⌕",
  },
  {
    id: "role",
    label: "Onboard to my role",
    desc: "Take the guided tour built for this project.",
    icon: "✦",
  },
  {
    id: "exploring",
    label: "Just exploring",
    desc: "Open the project overview and roam freely.",
    icon: "✣",
  },
];

export default function OnboardingOverlay({ onDismiss }: Props) {
  const graph = useDashboardStore((s) => s.graph);
  const setOnboardingGoal = useDashboardStore((s) => s.setOnboardingGoal);
  const [stepIdx, setStepIdx] = useState(0);

  // Item 131: derive cards from the actual graph once it's loaded.
  const cards = useMemo<Card[]>(() => {
    if (!graph) {
      return [
        {
          tag: "Welcome",
          title: "Understand Anything",
          body: "Loading your project graph…",
        },
      ];
    }
    const { project, nodes, edges, layers } = graph;
    const topLayer = [...layers].sort((a, b) => b.nodeIds.length - a.nodeIds.length)[0];
    const langs = project.languages.length
      ? project.languages.join(", ")
      : "this codebase";
    return [
      {
        tag: "Welcome",
        title: project.name,
        body:
          project.description?.trim() ||
          `An interactive map of ${project.name}, written in ${langs}.`,
        hint: `${nodes.length.toLocaleString()} nodes · ${edges.length.toLocaleString()} relationships across ${layers.length} layers.`,
      },
      {
        tag: "How it's organized",
        title: topLayer
          ? `${layers.length} layers — largest is "${topLayer.name}"`
          : `${layers.length} architectural layers`,
        body: topLayer
          ? `${topLayer.name} holds ${topLayer.nodeIds.length.toLocaleString()} nodes${topLayer.description ? ` — ${topLayer.description}` : ""}. Each layer groups related files so you can read the system top-down.`
          : "Nodes are grouped into logical layers so you can read the system top-down.",
        hint: "Click any layer in the graph to drill in; press ? for shortcuts.",
      },
      {
        tag: "Ways to learn",
        title: "Tour, trace, and search",
        body:
          "Take the guided Tour to learn the codebase step-by-step, Trace a call chain from any node, or Search to jump straight to what you need.",
        hint: graph.tour.length
          ? `A ${graph.tour.length}-step guided tour is ready for this project.`
          : "Use the structural map and search to navigate.",
      },
    ];
  }, [graph]);

  const lastCardIdx = cards.length; // the goal card sits after the info cards
  const isGoalCard = stepIdx === lastCardIdx;
  const total = cards.length + 1;

  // Capture-phase Escape handler — runs before the global keydown chain.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onDismiss]);

  const pickGoal = (goal: OnboardingGoal) => {
    setOnboardingGoal(goal);
    onDismiss(true);
  };

  const card = cards[Math.min(stepIdx, cards.length - 1)];
  const isFirst = stepIdx === 0;

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss(false);
      }}
    >
      <style>{KEYFRAMES}</style>
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} style={cardStyle}>
        <div style={tagStyle}>
          <span style={numStyle}>0{stepIdx + 1}</span>
          <span> / 0{total}</span>
          <span style={dotStyle} />
          <span>{isGoalCard ? "Pick your goal" : card.tag}</span>
        </div>

        {isGoalCard ? (
          <>
            <h2 id={TITLE_ID} style={titleStyle}>
              What brings you here?
            </h2>
            <p style={bodyStyle}>
              Pick a goal and we'll drop you in the right place. You can change
              your mind at any time.
            </p>
            <div style={goalGridStyle}>
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => pickGoal(g.id)}
                  style={goalBtnStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-accent)";
                    e.currentTarget.style.background = "var(--color-accent-overlay-bg)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-border-medium)";
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={goalIconStyle}>{g.icon}</span>
                  <span>
                    <span style={goalLabelStyle}>{g.label}</span>
                    <span style={goalDescStyle}>{g.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 id={TITLE_ID} style={titleStyle}>
              {card.title}
            </h2>
            <p style={bodyStyle}>{card.body}</p>
            {card.hint && (
              <blockquote style={hintStyle}>
                <span style={{ color: "var(--color-accent)", marginRight: 8 }}>·</span>
                {card.hint}
              </blockquote>
            )}
          </>
        )}

        <div style={progressTrackStyle}>
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              style={{
                ...dotProgressStyle,
                background:
                  i === stepIdx
                    ? "var(--color-accent)"
                    : "var(--color-border-medium)",
                width: i === stepIdx ? 28 : 6,
              }}
            />
          ))}
        </div>

        <div style={btnRowStyle}>
          <button
            type="button"
            onClick={() => onDismiss(true)}
            style={{ ...btnStyle, ...btnGhostStyle }}
          >
            Skip
          </button>
          <div style={{ flex: 1 }} />
          {!isFirst && (
            <button
              type="button"
              onClick={() => setStepIdx(stepIdx - 1)}
              style={{ ...btnStyle, ...btnGhostStyle }}
            >
              Back
            </button>
          )}
          {!isGoalCard && (
            <button
              type="button"
              onClick={() => setStepIdx(stepIdx + 1)}
              style={{ ...btnStyle, ...btnPrimaryStyle }}
            >
              {stepIdx === cards.length - 1 ? "Choose a goal →" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const KEYFRAMES = `@keyframes ua-fade-in { from { opacity: 0 } to { opacity: 1 } }`;

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.78)",
  backdropFilter: "blur(6px)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  fontFamily: "var(--font-sans)",
  animation: "ua-fade-in 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
};

const cardStyle: React.CSSProperties = {
  background: "var(--color-elevated)",
  color: "var(--color-text-primary)",
  maxWidth: 580,
  width: "100%",
  padding: "48px 48px 36px",
  border: "1px solid var(--color-border-subtle)",
  borderTop: "2px solid var(--color-accent)",
  position: "relative",
};

const tagStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  letterSpacing: "0.3em",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  marginBottom: 24,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 4,
};

const numStyle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  color: "var(--color-accent)",
  fontSize: "0.9rem",
  letterSpacing: "0.1em",
  marginRight: 4,
};

const dotStyle: React.CSSProperties = {
  width: 4,
  height: 4,
  background: "var(--color-accent)",
  borderRadius: "50%",
  margin: "0 12px",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.7rem",
  fontWeight: 400,
  letterSpacing: "0.02em",
  lineHeight: 1.3,
  marginBottom: 16,
  color: "var(--color-text-primary)",
};

const bodyStyle: React.CSSProperties = {
  fontSize: "0.98rem",
  lineHeight: 1.7,
  color: "var(--color-text-secondary)",
  marginBottom: 0,
};

const hintStyle: React.CSSProperties = {
  margin: "20px 0 0",
  padding: "12px 18px",
  borderLeft: "2px solid var(--color-border-medium)",
  background: "var(--color-accent-overlay-bg)",
  fontSize: "0.86rem",
  color: "var(--color-accent)",
  fontStyle: "italic",
};

const goalGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 10,
  marginTop: 22,
};

const goalBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  width: "100%",
  textAlign: "left",
  padding: "12px 16px",
  border: "1px solid var(--color-border-medium)",
  background: "transparent",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
};

const goalIconStyle: React.CSSProperties = {
  fontSize: "1.2rem",
  color: "var(--color-accent)",
  width: 24,
  textAlign: "center",
  flexShrink: 0,
};

const goalLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.95rem",
  fontWeight: 500,
  marginBottom: 2,
};

const goalDescStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

const progressTrackStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 36,
  marginBottom: 28,
};

const dotProgressStyle: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  transition: "width 0.5s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s",
};

const btnRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const btnStyle: React.CSSProperties = {
  padding: "10px 22px",
  fontSize: "0.82rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  border: "1px solid",
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
  fontWeight: 400,
};

const btnGhostStyle: React.CSSProperties = {
  background: "transparent",
  borderColor: "var(--color-border-medium)",
  color: "var(--color-text-muted)",
};

const btnPrimaryStyle: React.CSSProperties = {
  background: "var(--color-accent)",
  borderColor: "var(--color-accent)",
  color: "var(--color-root)",
  fontWeight: 500,
};

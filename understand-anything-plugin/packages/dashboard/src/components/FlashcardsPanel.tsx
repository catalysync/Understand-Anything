import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { isCardDue, type FlashcardReview } from "../utils/teachPersist";

/**
 * Item 163: Flashcards from bookmarks / glossary.
 *
 * Turns bookmarked nodes + glossary terms (concept / domain nodes) into Q/A
 * flashcards — "What does X do?" → reveal summary. A simple "got it / again"
 * grades each card into a Leitner box (spaced review, persisted to
 * localStorage), and a due-count drives the review queue.
 */

interface Card {
  id: string;
  question: string;
  answer: string;
  /** Underlying structural node, so the card can deep-link. */
  nodeId: string | null;
  source: "bookmark" | "glossary";
}

export default function FlashcardsPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const bookmarks = useDashboardStore((s) => s.workspace.bookmarks);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const reviews = useDashboardStore((s) => s.flashcardReviews);
  const gradeFlashcard = useDashboardStore((s) => s.gradeFlashcard);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const markVisited = useDashboardStore((s) => s.markVisited);

  const cards = useMemo<Card[]>(() => {
    const out: Card[] = [];
    const seen = new Set<string>();

    // Bookmarked nodes → "What does <name> do?"
    for (const bm of bookmarks) {
      const node = nodesById.get(bm.nodeId);
      if (!node) continue;
      const id = `bm:${bm.nodeId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        question: `What does ${bm.label || node.name} do?`,
        answer: node.summary || "(no summary available)",
        nodeId: node.id,
        source: "bookmark",
      });
    }

    // Glossary terms (concept / domain) → "Define <term>"
    const pushTerm = (name: string, summary: string, nodeId: string | null) => {
      const id = `term:${name.toLowerCase()}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({
        id,
        question: `Define: ${name}`,
        answer: summary || "(no definition available)",
        nodeId,
        source: "glossary",
      });
    };
    for (const n of graph?.nodes ?? []) {
      if (n.type === "concept" || n.type === "domain")
        pushTerm(n.name, n.summary, n.id);
    }
    for (const n of domainGraph?.nodes ?? []) {
      if (n.type === "domain" || n.type === "concept")
        pushTerm(n.name, n.summary, null);
    }
    return out;
  }, [bookmarks, nodesById, graph, domainGraph]);

  const dueCards = useMemo(
    () => cards.filter((c) => isCardDue(reviews[c.id])),
    [cards, reviews],
  );

  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Clamp the index when the deck shrinks (e.g. after grading).
  const safeIdx = dueCards.length ? idx % dueCards.length : 0;
  const card = dueCards[safeIdx];

  const grade = (correct: boolean) => {
    if (!card) return;
    gradeFlashcard(card.id, correct);
    setRevealed(false);
    // Advance: the graded card drops out of `dueCards` on next render, so keep
    // the same index (now pointing at the next card) but reset reveal.
    setIdx((i) => i + (correct ? 1 : 0));
  };

  if (cards.length === 0) {
    return (
      <div className="p-6 text-center text-text-muted text-sm">
        Bookmark some nodes (or add concept/domain nodes) to build a flashcard
        deck.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-3 pb-2 shrink-0 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
          Flashcards
        </span>
        <span
          className={`text-xs font-mono px-2 py-0.5 rounded-full ${
            dueCards.length
              ? "bg-accent/15 text-accent"
              : "bg-elevated text-text-muted"
          }`}
          title="Cards due for review"
        >
          {dueCards.length} due · {cards.length} total
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 flex flex-col">
        {dueCards.length === 0 || !card ? (
          <div className="flex-1 flex items-center justify-center text-center text-text-muted text-sm">
            🎉 All caught up — no cards due right now.
          </div>
        ) : (
          <>
            <div className="mt-2 rounded-xl border border-border-medium bg-elevated p-5 min-h-[160px] flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface text-text-muted">
                  {card.source}
                </span>
                <BoxBadge review={reviews[card.id]} />
              </div>
              <p className="text-base font-medium text-text-primary leading-snug">
                {card.question}
              </p>
              {revealed ? (
                <p className="text-sm text-text-secondary leading-relaxed mt-3 border-t border-border-subtle pt-3">
                  {card.answer}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="mt-auto self-start text-sm text-accent hover:underline"
                >
                  Reveal answer →
                </button>
              )}
              {revealed && card.nodeId && (
                <button
                  type="button"
                  onClick={() => {
                    markVisited(card.nodeId!);
                    focusEntity(card.nodeId!, { view: "structural" });
                  }}
                  className="mt-3 self-start text-[11px] text-text-muted hover:text-accent transition-colors"
                >
                  Open in graph →
                </button>
              )}
            </div>

            {revealed && (
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => grade(false)}
                  className="flex-1 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-red-300 text-sm font-medium hover:bg-red-500/10 transition-colors"
                >
                  Again
                </button>
                <button
                  type="button"
                  onClick={() => grade(true)}
                  className="flex-1 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-sm font-medium hover:bg-emerald-500/10 transition-colors"
                >
                  Got it
                </button>
              </div>
            )}

            <p className="text-center text-[11px] text-text-muted mt-3">
              Card {safeIdx + 1} of {dueCards.length} due
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function BoxBadge({ review }: { review: FlashcardReview | undefined }) {
  const box = review?.box ?? 0;
  return (
    <span
      className="text-[10px] font-mono text-text-muted"
      title={`Leitner box ${box} — higher boxes review less often`}
    >
      {"●".repeat(box + 1)}
      <span className="opacity-30">{"●".repeat(Math.max(0, 4 - box))}</span>
    </span>
  );
}

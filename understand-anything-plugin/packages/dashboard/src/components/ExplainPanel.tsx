import { useState } from "react";
import BookProse from "./BookProse";
import type { Affordances, ExplainState } from "./useCodeAssist";
import { SLASH_VERBS, expandSlashVerb } from "./useCodeAssist";
import type { TraceLevel } from "../store";

interface ExplainPanelProps {
  state: ExplainState;
  title: string;
  onClose: () => void;
  /** Submit a follow-up; slash verbs are expanded by the panel before calling. */
  onAsk: (question: string) => void;
  /** Jump to a cited file:line (feature 34). Omit to render citations as inert. */
  onCitation?: (file: string, line: number) => void;
  /** Feature 37b: current answer-detail level + setter (omit to hide the toggle). */
  level?: TraceLevel;
  onLevel?: (level: TraceLevel) => void;
}

function Shimmer({ label }: { label: string }) {
  return (
    <div className="space-y-1.5 py-1">
      <div className="h-2.5 w-full rounded bg-border-medium/40 animate-pulse" />
      <div className="h-2.5 w-[85%] rounded bg-border-medium/40 animate-pulse" />
      <div className="h-2.5 w-[70%] rounded bg-border-medium/40 animate-pulse" />
      <div className="text-[10px] text-text-muted pt-1">{label}</div>
    </div>
  );
}

/** Feature 34: clickable file:line citation links. */
function Citations({
  aff,
  onCitation,
}: {
  aff: Affordances;
  onCitation?: (file: string, line: number) => void;
}) {
  if (aff.citations.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-wider text-text-muted">Sources</span>
      {aff.citations.map((c, i) => (
        <button
          key={`${c.file}:${c.line}:${i}`}
          type="button"
          data-testid="citation-link"
          onClick={() => onCitation?.(c.file, c.line)}
          disabled={!onCitation}
          className="text-[10.5px] font-mono px-1.5 py-0.5 rounded border border-border-subtle text-text-muted hover:text-accent hover:border-accent/50 transition-colors disabled:cursor-default"
          title={`Jump to ${c.file}:${c.line}`}
        >
          {c.file.split("/").pop()}:{c.line}
        </button>
      ))}
    </div>
  );
}

/** Feature 32: clickable suggested-question chips that resume the session. */
function SuggestedChips({
  aff,
  onAsk,
  disabled,
}: {
  aff: Affordances;
  onAsk: (q: string) => void;
  disabled: boolean;
}) {
  if (aff.suggestedQuestions.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {aff.suggestedQuestions.map((q, i) => (
        <button
          key={i}
          type="button"
          data-testid="suggested-chip"
          onClick={() => onAsk(q)}
          disabled={disabled}
          className="text-[11px] px-2 py-1 rounded-full border border-accent/40 text-accent hover:text-accent-bright hover:border-accent/70 hover:bg-accent/5 transition-colors disabled:opacity-40"
          title="Ask this — resumes the same session"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

/**
 * The book-styled explanation panel + interactive follow-up Q&A thread,
 * grounded in the same claude session as the initial explanation. Wave-4 adds
 * suggested-question chips, slash verbs, citations, quiz answering, a level
 * toggle + simpler/deeper, and a low-confidence clarify chip.
 */
export default function ExplainPanel({
  state,
  title,
  onClose,
  onAsk,
  onCitation,
  level,
  onLevel,
}: ExplainPanelProps) {
  const [draft, setDraft] = useState("");
  const [showSlash, setShowSlash] = useState(false);

  // Slash verbs are expanded before sending so the session gets the full prompt.
  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || state.followUpLoading) return;
    const { expanded } = expandSlashVerb(text);
    onAsk(expanded);
    setDraft("");
    setShowSlash(false);
  };

  const submit = () => send(draft);

  // Affordances for the latest turn (initial answer, or the last assistant turn).
  const latestAff =
    state.thread.length > 0
      ? state.thread[state.thread.length - 1].affordances ?? state.affordances
      : state.affordances;

  const isQuiz = state.mode === "quiz";

  return (
    <div className="rounded-md border border-accent/30 bg-elevated/80 px-3.5 py-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-accent font-semibold">{title}</span>
        <div className="flex items-center gap-2">
          {/* Feature 37b: level toggle */}
          {level && onLevel && (
            <div className="flex items-center gap-0.5 rounded border border-border-subtle p-0.5">
              {(["beginner", "intermediate", "expert"] as TraceLevel[]).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  data-testid={`level-${lv}`}
                  onClick={() => onLevel(lv)}
                  className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors ${
                    level === lv ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
                  }`}
                  title={`Answer at ${lv} level`}
                >
                  {lv[0]}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xs"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {state.status === "loading" && <Shimmer label="Asking claude -p… (this can take ~10-20s)" />}
      {state.status === "error" && (
        <p className="text-[12px] text-node-concept leading-relaxed whitespace-normal">{state.error}</p>
      )}

      {state.status === "loaded" && state.explanation && (
        <>
          <BookProse>{state.explanation}</BookProse>

          {/* Citations + suggested chips for the initial answer (only when no
              follow-up thread has superseded them). */}
          {state.thread.length === 0 && (
            <>
              <Citations aff={state.affordances} onCitation={onCitation} />
              <SuggestedChips aff={state.affordances} onAsk={send} disabled={state.followUpLoading} />
            </>
          )}

          {/* Follow-up Q&A thread */}
          {(state.thread.length > 0 || state.followUpLoading) && (
            <div className="mt-3 pt-3 border-t border-border-subtle space-y-2.5">
              {state.thread.map((turn, i) =>
                turn.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div
                      className="max-w-[85%] rounded-lg rounded-br-sm px-3 py-1.5 text-[12.5px] leading-relaxed"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {turn.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="pl-1">
                    <BookProse>{turn.text}</BookProse>
                    {/* Affordances for the most recent assistant turn only. */}
                    {i === state.thread.length - 1 && (
                      <>
                        <Citations aff={latestAff} onCitation={onCitation} />
                        <SuggestedChips aff={latestAff} onAsk={send} disabled={state.followUpLoading} />
                      </>
                    )}
                  </div>
                ),
              )}
              {state.followUpLoading && <Shimmer label="Thinking…" />}
            </div>
          )}

          {/* Feature 43: low-confidence clarifying chip — resumes the session. */}
          {!state.followUpLoading &&
            latestAff.confidence !== null &&
            latestAff.confidence < 0.5 &&
            latestAff.clarifyingQuestion && (
              <div className="mt-2.5" data-testid="clarify-chip">
                <span className="text-[10px] text-amber-500/90 mr-1">⚠ low confidence —</span>
                <button
                  type="button"
                  onClick={() => send(latestAff.clarifyingQuestion)}
                  className="text-[11px] px-2 py-1 rounded-full border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 transition-colors"
                  title="Answer this so Claude can do better"
                >
                  {latestAff.clarifyingQuestion}
                </button>
              </div>
            )}

          {/* Follow-up input + slash verbs + simpler/deeper */}
          {state.sessionId && (
            <>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setShowSlash(e.target.value.trim().startsWith("/"));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={
                    isQuiz ? "Type your answer…" : "Ask a follow-up, or type / for verbs…"
                  }
                  disabled={state.followUpLoading}
                  data-testid="followup-input"
                  className="flex-1 min-w-0 bg-surface text-text-primary text-[12.5px] rounded-md px-2.5 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={state.followUpLoading || !draft.trim()}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-accent/40 text-accent hover:text-accent-bright hover:border-accent/70 transition-colors disabled:opacity-40"
                >
                  {isQuiz ? "Submit" : "Ask"}
                </button>
              </div>

              {/* Feature 33: slash-verb menu (shown while typing a "/"). */}
              {showSlash && (
                <div className="mt-1.5 flex flex-wrap gap-1" data-testid="slash-menu">
                  {Object.keys(SLASH_VERBS).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => send(v)}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle text-text-muted hover:text-accent hover:border-accent/50 transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}

              {/* Feature 37b: per-answer simpler / deeper re-ask in-session. */}
              {!isQuiz && (
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => send("/simpler")}
                    disabled={state.followUpLoading}
                    className="text-[10px] text-text-muted hover:text-accent transition-colors disabled:opacity-40"
                  >
                    ↓ simpler
                  </button>
                  <button
                    type="button"
                    onClick={() => send("/deeper")}
                    disabled={state.followUpLoading}
                    className="text-[10px] text-text-muted hover:text-accent transition-colors disabled:opacity-40"
                  >
                    ↑ deeper
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

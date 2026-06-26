import { useState } from "react";
import BookProse from "./BookProse";
import type { ExplainState } from "./useCodeAssist";

interface ExplainPanelProps {
  state: ExplainState;
  title: string;
  onClose: () => void;
  onAsk: (question: string) => void;
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

/**
 * The book-styled explanation panel + interactive follow-up Q&A thread,
 * grounded in the same claude session as the initial explanation.
 */
export default function ExplainPanel({ state, title, onClose, onAsk }: ExplainPanelProps) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const q = draft.trim();
    if (!q || state.followUpLoading) return;
    onAsk(q);
    setDraft("");
  };

  return (
    <div className="rounded-md border border-accent/30 bg-elevated/80 px-3.5 py-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-accent font-semibold">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary text-xs"
          title="Close"
        >
          ✕
        </button>
      </div>

      {state.status === "loading" && <Shimmer label="Asking claude -p… (this can take ~10-20s)" />}
      {state.status === "error" && (
        <p className="text-[12px] text-node-concept leading-relaxed whitespace-normal">{state.error}</p>
      )}

      {state.status === "loaded" && state.explanation && (
        <>
          <BookProse>{state.explanation}</BookProse>

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
                  </div>
                ),
              )}
              {state.followUpLoading && <Shimmer label="Thinking…" />}
            </div>
          )}

          {/* Follow-up input */}
          {state.sessionId && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Ask a follow-up about this code…"
                disabled={state.followUpLoading}
                className="flex-1 min-w-0 bg-surface text-text-primary text-[12.5px] rounded-md px-2.5 py-1.5 border border-border-subtle focus:outline-none focus:border-accent/50 placeholder-text-muted disabled:opacity-60"
              />
              <button
                type="button"
                onClick={submit}
                disabled={state.followUpLoading || !draft.trim()}
                className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-accent/40 text-accent hover:text-accent-bright hover:border-accent/70 transition-colors disabled:opacity-40"
              >
                Ask
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

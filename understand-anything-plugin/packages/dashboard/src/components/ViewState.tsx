// Item 200a: a unified <ViewState kind="loading|empty|error|partial" /> for the
// main view branches' empty / error / loading / partial states. One component =
// consistent copy, spacing, and a retry affordance across structural / domain /
// trace / knowledge instead of each view rolling its own.

export type ViewStateKind = "loading" | "empty" | "error" | "partial";

interface ViewStateProps {
  kind: ViewStateKind;
  /** Headline (defaults per kind). */
  title?: string;
  /** Supporting copy. */
  message?: string;
  /** Optional retry / primary action. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Optional secondary action node (e.g. a "run the skill" hint). */
  action?: React.ReactNode;
}

const ICONS: Record<ViewStateKind, string> = {
  loading: "◌",
  empty: "○",
  error: "⚠",
  partial: "◐",
};

const DEFAULT_TITLE: Record<ViewStateKind, string> = {
  loading: "Loading…",
  empty: "Nothing here yet",
  error: "Something went wrong",
  partial: "Partial data",
};

export default function ViewState({
  kind,
  title,
  message,
  onRetry,
  retryLabel = "Retry",
  action,
}: ViewStateProps) {
  return (
    <div
      className="h-full w-full flex items-center justify-center p-8"
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      data-testid={`view-state-${kind}`}
    >
      <div className="max-w-sm text-center">
        <div
          className={`text-3xl mb-3 ${kind === "loading" ? "animate-pulse" : ""} ${
            kind === "error" ? "text-node-concept" : "text-text-muted"
          }`}
          aria-hidden
        >
          {ICONS[kind]}
        </div>
        <h3 className="font-heading text-base text-text-primary mb-1.5">
          {title ?? DEFAULT_TITLE[kind]}
        </h3>
        {message && (
          <p className="text-[13px] text-text-muted leading-relaxed">{message}</p>
        )}
        {(onRetry || action) && (
          <div className="mt-4 flex items-center justify-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-3 py-1.5 rounded-md text-xs font-semibold border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
              >
                {retryLabel}
              </button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

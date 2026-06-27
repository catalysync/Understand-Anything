// Layout ergonomics: a reusable collapsible container with a header toggle
// (chevron + label) and localStorage-persisted open/closed state. Used to tame
// the dense trace toolbar + the converse-with-Claude bar so they read cleanly
// and can be folded out of the way. Persists under a caller-supplied key (the
// server workspace whitelist drops unknown keys, so these live client-side).
import { useCallback, useEffect, useState, type ReactNode } from "react";

function readOpen(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return fallback;
}

function persistOpen(key: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export default function Collapsible({
  storageKey,
  label,
  defaultOpen = true,
  right,
  children,
  className = "",
  testId,
}: {
  /** localStorage key — persists collapsed/expanded across reloads. */
  storageKey: string;
  /** Header label (e.g. "Controls", "Claude"). */
  label: ReactNode;
  defaultOpen?: boolean;
  /** Optional compact preview / actions rendered on the right of the header. */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState<boolean>(() => readOpen(storageKey, defaultOpen));

  // Keep persistence in sync if the key changes (rare).
  useEffect(() => {
    setOpen(readOpen(storageKey, defaultOpen));
  }, [storageKey, defaultOpen]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      persistOpen(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return (
    <div
      data-testid={testId}
      className={`rounded border border-border-subtle/60 bg-surface/40 ${className}`}
    >
      <div className="flex items-center gap-2 px-2.5 py-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted hover:text-text-primary transition-colors"
          title={open ? "Collapse" : "Expand"}
        >
          <span
            className={`inline-block transition-transform duration-150 text-[9px] ${
              open ? "rotate-90" : "rotate-0"
            }`}
            aria-hidden
          >
            ▶
          </span>
          {label}
        </button>
        {right && (
          <div className="ml-auto flex items-center gap-1.5 min-w-0">{right}</div>
        )}
      </div>
      {open && <div className="px-2.5 pb-2 pt-0.5">{children}</div>}
    </div>
  );
}

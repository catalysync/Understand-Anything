import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";

/**
 * Item 168: "Acronyms in this repo" list.
 *
 * Scans node names + summaries for repeated capitalized abbreviations
 * (DTO / RPC / SFTP / API …) and lists the most frequent ones. Each has a
 * "define with Claude" affordance that lazily POSTs to /explain.json ON CLICK
 * only — never during QA / load. A guessed expansion (when a long-form appears
 * verbatim in the corpus) is shown for free without any model call.
 */

interface Acronym {
  text: string;
  count: number;
  /** A long-form guessed from the corpus, if one is confidently present. */
  guess: string | null;
  /** Example contexts (truncated) where it appears. */
  example: string;
}

// Common English words that look like acronyms but aren't worth listing.
const STOPWORDS = new Set([
  "THE",
  "AND",
  "FOR",
  "NOT",
  "ALL",
  "ANY",
  "NEW",
  "GET",
  "SET",
  "ADD",
  "RUN",
  "USE",
  "MAP",
  "KEY",
  "ID",
  "URL",
  "URI",
]);

function detectAcronyms(texts: string[]): Acronym[] {
  const counts = new Map<string, number>();
  const examples = new Map<string, string>();
  const corpus = texts.join("\n");

  // 2–6 uppercase letters (optionally with digits) as a whole token.
  const re = /\b([A-Z]{2,6}[0-9]?)\b/g;
  for (const text of texts) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const tok = m[1];
      if (STOPWORDS.has(tok)) continue;
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
      if (!examples.has(tok)) {
        examples.set(tok, text.length > 90 ? text.slice(0, 90) + "…" : text);
      }
    }
  }

  const out: Acronym[] = [];
  for (const [text, count] of counts) {
    if (count < 2) continue; // "repeated"
    out.push({
      text,
      count,
      guess: guessExpansion(text, corpus),
      example: examples.get(text) ?? "",
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Cheap, no-LLM expansion guess: if the corpus contains a Title-Cased phrase
 * whose initials spell the acronym (e.g. "Data Transfer Object" for DTO),
 * surface it. Returns null otherwise (the "define with Claude" button covers
 * the rest, lazily).
 */
function guessExpansion(acr: string, corpus: string): string | null {
  const n = acr.replace(/[0-9]/g, "").length;
  if (n < 2) return null;
  // Match n consecutive Capitalized words.
  const wordRe = /\b([A-Z][a-z]{1,15})(?:\s+([A-Z][a-z]{1,15})){1,5}\b/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(corpus)) !== null) {
    const phrase = m[0];
    const initials = phrase
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    if (initials === acr.replace(/[0-9]/g, "")) return phrase;
  }
  return null;
}

export default function AcronymsPanel({
  accessToken,
}: {
  accessToken: string;
}) {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);

  const acronyms = useMemo<Acronym[]>(() => {
    const texts: string[] = [];
    for (const n of graph?.nodes ?? []) {
      texts.push(n.name);
      if (n.summary) texts.push(n.summary);
    }
    for (const n of domainGraph?.nodes ?? []) {
      texts.push(n.name);
      if (n.summary) texts.push(n.summary);
    }
    return detectAcronyms(texts).slice(0, 40);
  }, [graph, domainGraph]);

  // Lazy per-acronym definition state (only filled on click).
  const [defs, setDefs] = useState<
    Record<string, { loading: boolean; text?: string; error?: string }>
  >({});

  const define = (acr: Acronym) => {
    if (defs[acr.text]?.loading || defs[acr.text]?.text) return;
    if (accessToken === "__demo__") {
      setDefs((d) => ({
        ...d,
        [acr.text]: {
          loading: false,
          error: "Definitions require the local dashboard server.",
        },
      }));
      return;
    }
    setDefs((d) => ({ ...d, [acr.text]: { loading: true } }));
    const projectName = graph?.project?.name ?? "this codebase";
    const question = `In the context of the software project "${projectName}", what does the acronym "${acr.text}" most likely stand for and mean? Answer in one or two sentences. Example usage: "${acr.example}".`;
    // Lazy, on-click only. Uses the generic question mode of /explain.json.
    fetch("/explain.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: accessToken, mode: "question", question }),
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          explanation?: string;
          result?: string;
          error?: string;
        };
        const text = (data.explanation || data.result || "").trim();
        if (!res.ok || !text) throw new Error(data.error || "No definition");
        setDefs((d) => ({ ...d, [acr.text]: { loading: false, text } }));
      })
      .catch((err: unknown) => {
        setDefs((d) => ({
          ...d,
          [acr.text]: {
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      });
  };

  if (acronyms.length === 0) {
    return (
      <div className="p-6 text-center text-text-muted text-sm">
        No repeated acronyms detected in this graph.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <p className="text-[11px] text-text-muted">
          Repeated capitalized abbreviations across node names &amp; summaries.
          A guessed expansion is free; “Define” asks Claude on demand.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 space-y-2">
        {acronyms.map((acr) => {
          const def = defs[acr.text];
          return (
            <div
              key={acr.text}
              className="rounded-lg border border-border-subtle bg-elevated px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-accent">
                  {acr.text}
                </span>
                <span className="text-[10px] text-text-muted font-mono">
                  ×{acr.count}
                </span>
                {acr.guess && (
                  <span className="text-xs text-text-secondary truncate">
                    — {acr.guess}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => define(acr)}
                  disabled={def?.loading || !!def?.text}
                  className="ml-auto text-[11px] px-2 py-0.5 rounded border border-border-subtle text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-50 shrink-0"
                  title="Ask Claude to define this acronym (one request)"
                >
                  {def?.loading
                    ? "Defining…"
                    : def?.text
                      ? "Defined"
                      : "Define"}
                </button>
              </div>
              {def?.text && (
                <p className="text-xs text-text-secondary leading-relaxed mt-2 border-t border-border-subtle pt-2">
                  {def.text}
                </p>
              )}
              {def?.error && (
                <p className="text-xs text-red-300 mt-2">{def.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

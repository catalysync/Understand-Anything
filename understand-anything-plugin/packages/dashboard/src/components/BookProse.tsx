import ReactMarkdown from "react-markdown";
import type { ReactNode } from "react";

/**
 * Renders claude -p markdown output as a beautifully typeset "programming
 * book" page: refined serif body, readable measure, generous line-height,
 * inline-code chips and clear paragraph/list spacing. Theme-matched via the
 * existing --color-* CSS vars so it adapts to light/dark presets.
 */
export default function BookProse({ children }: { children: string }) {
  return (
    <div
      className="book-prose text-text-primary"
      style={{
        maxWidth: "64ch",
        fontFamily: "var(--font-serif)",
        fontSize: "13.5px",
        lineHeight: 1.7,
      }}
    >
      <ReactMarkdown
        components={{
          p: ({ children }: { children?: ReactNode }) => (
            <p className="mb-3 last:mb-0">{children}</p>
          ),
          strong: ({ children }: { children?: ReactNode }) => (
            <strong className="font-semibold text-text-primary">{children}</strong>
          ),
          em: ({ children }: { children?: ReactNode }) => (
            <em className="italic">{children}</em>
          ),
          ul: ({ children }: { children?: ReactNode }) => (
            <ul className="list-disc pl-5 mb-3 space-y-1.5">{children}</ul>
          ),
          ol: ({ children }: { children?: ReactNode }) => (
            <ol className="list-decimal pl-5 mb-3 space-y-1.5">{children}</ol>
          ),
          li: ({ children }: { children?: ReactNode }) => (
            <li className="leading-relaxed">{children}</li>
          ),
          code: ({ children, className }: { children?: ReactNode; className?: string }) => {
            const isBlock = (className ?? "").includes("language-");
            if (isBlock) {
              return (
                <code
                  className="block my-2 p-3 rounded-md overflow-x-auto text-[12px] leading-relaxed"
                  style={{
                    fontFamily: "var(--font-mono)",
                    backgroundColor: "color-mix(in srgb, var(--color-text-primary) 6%, transparent)",
                    border: "1px solid var(--color-border-subtle)",
                  }}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded text-[0.85em]"
                style={{
                  fontFamily: "var(--font-mono)",
                  backgroundColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                  color: "var(--color-accent-bright)",
                }}
              >
                {children}
              </code>
            );
          },
          h1: ({ children }: { children?: ReactNode }) => (
            <h3 className="font-semibold text-text-primary mt-3 mb-1.5 text-[15px]">{children}</h3>
          ),
          h2: ({ children }: { children?: ReactNode }) => (
            <h4 className="font-semibold text-text-primary mt-3 mb-1.5 text-[14px]">{children}</h4>
          ),
          h3: ({ children }: { children?: ReactNode }) => (
            <h4 className="font-semibold text-text-primary mt-3 mb-1.5 text-[13.5px]">{children}</h4>
          ),
          a: ({ children, href }: { children?: ReactNode; href?: string }) => (
            <a href={href} className="text-accent hover:underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

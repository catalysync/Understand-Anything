# 50 Interactive Features for the Trace Dashboard

A research-grounded roadmap for turning Understand-Anything's static knowledge graph into an
**interactive debugging + AI-tutoring surface**. Organized around three pillars:

1. **Working the multi-level trace tree** (engage with the call chain)
2. **Interactive debugging** (static analogues of debugger/tracing UX)
3. **Conversing with Claude in-context** (the `claude -p` backend, no API token)

Each feature is mapped to what the project already has: the **knowledge graph**
(`calls` / `imports` / `implements` / `contains` edges), the **Trace view** (a tree of hop-cards
with embedded source), and the **`claude -p`** explainer (sessions persist on disk, so
`--resume <session_id>` is durable).

> Researched from: Sourcegraph & Cody, Sourcetrail, SciTools Understand, CodeSee, OpenGrok, IDE
> call/type hierarchies · Chrome DevTools, Replay.io, rr, WinDbg TTD, Jaeger, Honeycomb, Datadog,
> Speedscope, pprof, Delve · Cursor, Zed AI, Copilot Chat, Continue, Claude Code.

---

## A · Working the multi-level trace tree
1. **Focus subtree (re-root)** — click a hop → it becomes the root; breadcrumb back. *(flamegraph zoom)*
2. **Walk up *and* down** — expand callers (inverted/butterfly) as easily as callees.
3. **Step into / over / out** — descend into a callee, skip to next sibling, pop to parent.
4. **Depth slider** — "expand to depth N" auto-opens N levels.
5. **Fold repeated helpers** — collapse-by-name (`log.*`, error-wrap, getters).
6. **Blackbox / mute packages** — grey out `runtime`, `net/http`, stdlib; show only *your* code.
7. **Critical-path highlight** — Claude flags the load-bearing branch; side branches dim.
8. **Minimap + active-path breadcrumb** — don't get lost after zooming deep.
9. **Path-between-two-nodes** — pick X and Y → shortest call/import chain.
10. **Bundled edges** — many calls into one module collapse to a weighted edge, expand on click.
11. **Switchable layouts** — nested tree ↔ flat indented list ↔ flamegraph "shape."

## B · Cross-reference & code intelligence
12. **Go-to-definition** on any call token → re-roots the trace there.
13. **Find references / callers panel** — inverted view of who calls this hop.
14. **Go-to-implementation** — interface hop expands into its concrete impls (via `implements`).
15. **Hover popover** — signature + summary + ref-count + trace/explain buttons.
16. **Peek definition inline** — expand a callee's source beneath the card, collapse back.
17. **Containment breadcrumb** per hop (`repo › pkg › file › func`).
18. **Inlay hints** — resolved param names/types ghosted into the embedded source.
19. **Goroutine / channel stitching** — dashed causal edge linking a `go func()` / channel send to its receiver.
20. **Fuzzy symbol palette (⌘P)** — jump to any node to start a trace.

## C · Interactive debugging (static analogues)
21. **Watch a symbol** — pin a name; every hop that reads/writes/calls it gets a badge.
22. **Jump to where it was set** — static dataflow walks back to the nearest assigning hop.
23. **Scope inspector** — per-hop panel of params / locals / captures / return.
24. **Logpoint = "explain this line"** — pin a `claude -p` explanation inline at one statement. *(shipped)*
25. **Annotate a hop** — sticky notes / findings pinned to nodes, persisted + shareable.
26. **Conditional highlight** — light up hops matching a predicate (returns error, in package Y, calls X).
27. **Error-path tracing** — for hops returning errors, trace + explain the failure chain.
28. **Complexity heat overlay** — color hops by complexity / fan-in / LOC.
29. **Per-function control-flow mini-diagram** — branches/loops inside a hop.
30. **Trace diff across commits** — added/removed/moved hops colored green/red (git-aware).

## D · Conversing with Claude, in-context
31. **session_id per node** — every node owns a Claude session; actions default to `--resume`. *(shipped)*
32. **Suggested follow-up chips** — Claude returns `suggested_questions[]` (JSON) → clickable chips.
33. **Slash verbs** — `/explain` · `/why-called` · `/data-flow` · `/go-idiom` · `/simpler` · `/deeper`.
34. **Citations to source lines** — answers cite `file:line` as clickable links that highlight the node.
35. **Explain-this-subtree** — select a branch → one session reasons across the whole sub-flow.
36. **Quiz me (Socratic)** — Claude asks *you* a question about the path and grades it.
37. **Persona / level toggle** — "new to Go" ↔ expert, injected as a system preamble. *(shipped)*
38. **Trace rules file** — project-wide always-on guidance for every prompt.
39. **@-mention context chips** — `@file`/`@symbol`/`@hop` seeds a prompt; removable chips show what Claude sees.
40. **@go-docs provider** — inject Go stdlib/spec docs for the symbols in the hop.
41. **Hover ghost-explain** — lazy, cached one-sentence tooltip; click to open the full session.
42. **"Walk me through this trace"** — Claude narrates a beginner tour, next/back, one session.
43. **Confidence + clarify** — Claude flags uncertainty / asks a clarifying question as a chip.

## E · Visualization & readability
44. **Color-by dimension** — package / architectural layer / AI-flagged-interesting.
45. **Pretty-print** — `gofmt` view + optional AI plain-English rewrite of a hop's source.
46. **Resizable, side-by-side code ↔ explanation** panes. *(shipped)*
47. **Reactive re-render** — re-asking or changing a watched symbol updates only affected hops.

## F · Capture, share & revisit
48. **Save a trace as a named tour** — steps auto-flag stale when the graph changes.
49. **Export a session as a "trace note"** — Q&A + cited code → a per-codebase learning log.
50. **Bookmarks / investigation panel** — bookmarked hops + notes → a shareable investigation. *(in progress)*

---

## Recommended first sprint (highest payoff-to-effort)
> **6** blackbox packages · **1** focus-subtree · **2** callers view · **12** goto-def ·
> **21+22** watch & jump-to-set · **32** suggested-question chips · **33** slash-verbs ·
> **34** citations · **36** quiz-me · **19** goroutine stitching

These answer the three beginner questions — *where does X appear / who set it / who calls it* — and
turn the trace tree into a Claude-powered tutor.

## Persistence
No database — state is file-based JSON in `.understand-anything/`. A `workspace.json` (bookmarks,
annotations, node→session map, watches, tours) plus the durable `claude -p` session store
(`~/.claude/projects/*.jsonl`) gives **store-context-and-resume** without a DB.

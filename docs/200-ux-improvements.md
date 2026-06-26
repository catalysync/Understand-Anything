# 200 UX / Quality-of-Life Improvements — Understand-Anything (whole app)

App-wide roadmap to make the four experiences — **structural graph · domain flows · trace tree · onboarding** — feel like *one* product, and to make the **skill/CLI** side pleasant. Researched against the real code (skills, `packages/core`, `packages/dashboard`). **Distinct from** the trace-feature catalog in [`50-interactive-trace-features.md`](./50-interactive-trace-features.md).

## The connective keystones (highest leverage — most other ideas hang off these)
- **K1. One `focusEntity` in the store** that all views read/write (replace the parallel `selectedNodeId`/`traceRoot`/`activeDomainId`/`focusNodeId`). Select once → it follows you everywhere.
- **K2. `setViewMode(mode, { keepSelection })`** — today it hard-resets selection (`store.ts`); carrying the node across views is the single biggest "feels like one product" fix.
- **K3. A node context-menu** (no `onNodeContextMenu` exists today) offering Trace · Explain · Show-in-domain · Find callers · Open source · Pin — the same actions from every view.
- **K4. Surface the rich-but-unused schema** — edge `weight`/`direction`/`description`, node `lineRange`/`tags`/`languageNotes` are populated by the analyzers and ignored by the UI.
- **K5. Skill↔dashboard loop** — `progress.json` during indexing, a staleness badge from `meta.json`, and "re-index this subtree" buttons.

---

## 1 · Skill & graph-generation pipeline (it's a skill — works at the CLI layer too)

**Scoping & `.understandignore`**
1. `--dry-run` scope preview — SCAN+BATCH only, print file/batch counts + what *would* analyze, no LLM dispatch.
2. `.understandignore` impact diff — on edit, "excluded N (was M); +X / −Y" before/after.
3. Heaviest-directories report at the >100-file gate (top dirs by file count + LOC) so users know what to ignore.
4. Post-scan ignore suggestions — auto-detect generated/vendored/snapshot dirs from real file data, offer to append.
5. Ephemeral glob scope args — `/understand "src/**" "!**/*.test.ts"` for one run, not written to the ignore file.
6. Named scope presets in `config.json` (`scopes: {backend: [...]}`) for consistent team re-runs.
7. `.understandignore` lint — warn on patterns matching zero files or excluding the whole project.
8. Negation coverage check — confirm a `!force-include` isn't shadowed by a built-in default.

**Cost / time / observability**
9. Pre-flight cost & time estimate before ANALYZE (batches × concurrency × historical timings).
10. Per-run telemetry → `meta.json` (batch timings, tokens/phase, wall-clock) to sharpen estimates.
11. `--budget` token cap that stops + saves a partial graph + un-analyzed manifest.
12. `--concurrency N` (the 5-cap is hardcoded) persisted in config.
13. Live `progress.json` + dashboard "indexing…" banner so you can open the dashboard *while* it builds. **[K5]**
14. ETA in the batch progress line from rolling timings.
15. Per-batch failure ledger ("3/12 batches failed — graph is partial").

**Resume / recovery / caching**
16. `--resume` — skip `batch-*.json` already on disk, re-dispatch only missing indices, then merge.
17. Quarantine-and-continue on a poisoned file (mark `analysisError`, suggest ignoring it) instead of failing the batch.
18. `--batch 7` targeted re-run of one batch after a fix.
19. Atomic graph writes (temp + `mv`) so a crash never corrupts `knowledge-graph.json`.
20. Validate-before-overwrite, keep `knowledge-graph.json.bak` if the rebuild is invalid.
21. `--only architecture|tour|review` phase-targeted re-runs from cached `assembled-graph.json`.
22. Cache `scan-result.json` keyed on tree-hash + ignore-hash (currently reused blindly → staleness bug).
23. Fingerprint cache keyed by content hash so branch switches don't force full re-analysis of identical files.
24. Reuse prior nodes/edges for fingerprint-unchanged files even under `--full`.

**Incremental correctness (the classifier is written but unwired)**
25. Route incremental updates through `change-classifier.ts` so cosmetic-only diffs hit SKIP.
26. Honor all 4 classifier tiers (SKIP/PARTIAL/ARCHITECTURE/FULL), not just "incremental vs full".
27. Prune nodes/edges for deleted/renamed files (`git diff --name-status`), not just changed ones.

**Freshness signals (skill ↔ dashboard)**
28. Dashboard staleness badge from `meta.json` + `git diff` with a one-click re-index. **[K5]**
29. "Re-index this subtree" — dashboard surfaces a scoped `/understand <subdir>` for stale folders. **[K5]**
30. Per-node staleness markers (dim nodes whose file changed since analysis).
31. `--status` — print last-analyzed time/commit/changed-files + recommended action, runs nothing.

**Auto-update / multi-language / monorepo**
32. Actually install the post-commit hook for `--auto-update` (today it's a no-op config flag).
33. Debounced/threshold auto-update via the classifier.
34. Auto-update result notification surfaced in the dashboard.
35. Per-language batch isolation so language-context injection isn't diluted.
36. Monorepo package auto-detection → one sub-graph per package (merge script already exists).
37. Cross-package edge stitching on merge (workspace imports → other sub-graphs' nodes).
38. `--package <name>` parallel sub-graph builds + a final `--merge`.

**Domain/knowledge cheapness, validation, config**
39. Incremental domain-graph updates (re-derive only if the knowledge graph advanced).
40. Auto-refresh domain graph after `/understand` when one already exists.
41. Shared scan cache between domain/knowledge/onboard skills.
42. Coverage report: scanned-vs-graphed files (surface gaps, don't assume 100%).
43. Actionable validation output (group/rank issues + suggested fixes).
44. Graph quality score (coverage/orphans/density/balance) in summary + `meta.json` + dashboard header.
45. `config.json` discoverability + `--config` to print/edit settings.

## 2 · Structural knowledge-graph experience

**Layout & navigation**
46. Layout switcher (Layered/Force/Radial/Tree/Grid) — both ELK + force already imported, only layered exposed.
47. TB⇄LR direction toggle (dependency-heavy graphs read better left-right).
48. "Hide leaf utilities" declutter toggle → `+N more` on the parent.
49. Focus+context spotlight with a 1–3 hop depth slider (extends existing neighbor-fade).
50. Pin/freeze node positions (ELK fixed-coords) to stop "everything jumped" after filtering.
51. Animated re-layout tweens instead of hard cuts on drill/filter.
52. "Recenter on selection" hotkey (`setCenter` plumbing exists).
53. Deep breadcrumb for nested drill (Layer › Folder › File), each clickable.

**Performance (big graphs)**
54. `onlyRenderVisibleElements` viewport virtualization — biggest FPS win at 1000s of nodes.
55. Level-of-detail node rendering by zoom (dot → name → full card).
56. Progressive/streamed node mount (degree-ranked, rAF-chunked) with "N of M".
57. Memoize ELK/force layouts by (graphHash + filters + opts).
58. Edge thinning above a density budget ("showing N of M edges").

**Edges (use the schema)**
59. Edge bundling for parallel runs between the same layer pairs. **[K4]**
60. Zoom-gated edge labels (`calls`/`imports`/`implements` appear on zoom-in).
61. Directional arrowheads + weight-scaled thickness from `direction`/`weight`. **[K4]**
62. Edge hover tooltip showing `description`. **[K4]**
63. Curved-vs-orthogonal routing toggle (`elk.edgeRouting`).
64. Edge-type legend with live visibility toggles.

**Search & filter**
65. Regex/glob search mode (`**/handlers/*.go`, `*Service`).
66. Scoped search prefixes (`type:function`, `layer:Data`, `tag:security`).
67. Search-result cycling (n/N, "3/17 matches") panning the canvas.
68. "Highlight matches across layers" result panel grouped by layer.
69. Recent + starred searches.
70. Tag filter facet (tags are the richest classifier and unfiltered today). **[K4]**
71. Complexity heat slider (min/max + "only complex").
72. Degree/connectivity filter (hide leaves / isolate hubs).
73. File-category filter (Code/Config/Docs/Infra/Data) from the overview buckets.
74. Filter presets ("Hubs only", "Untested complex code", "Public API surface").
75. Active-filter chips bar above the canvas (so missing nodes are explained).

**Node info / layers / metrics**
76. Inline ego-graph mini-map in `NodeInfo` (node + 1-hop neighbors).
77. Grouped directional connections (Calls/Called-by, Imports/Imported-by) — each row jumps.
78. Quick metrics strip (in/out degree, LOC from `lineRange`, layer, fan ratio).
79. Layer color picker + rename (auto-names like "Layer 3" aren't clear).
80. Layer expand-in-place (compare two layers without leaving overview).
81. Cross-layer dependency matrix/chord overlay (reveals layering violations).
82. "Entry points per layer" highlight (cross-layer-referenced nodes = the layer's public interface).
83. Complexity heatmap overlay (green→red across the whole graph).
84. Degree-centrality "hub" overlay with legend.
85. Test-coverage overlay (`tested` tag + `tested_by` edges → coverage gap map).

**Diff / states / sync**
86. Wire the diff overlay to git/PR (the `isDiffChanged` styling + `DiffToggle` already exist).
87. Stale-node indicators from `staleness.ts`.
88. Rich empty + filtered-to-nothing states (CTA + reset).
89. Bidirectional FileExplorer↔graph selection + per-file colored dots in the tree.
90. **Node context menu — the cross-view hub** (Trace/Explain/Show-in-domain/Callers/Open-source/Focus/Pin/Copy-id). **[K3]**

## 3 · Domain / business-flow experience

**Navigation**
91. Expand-in-place flow drill (accordion under a domain) instead of full-screen swap.
92. Collapse/expand steps per flow (a domain with 106 steps must stay readable).
93. Focus-a-flow mode (double-click isolates one flow + its cross-domain edges).
94. Domain-depth breadcrumb (Domains › Git Integration › Connect Repository).
95. Horizontal swim-lane layout per flow (business flows read left-to-right).
96. True sequential step numbering (current `weight*10` collides) — "Step 3 of 7".
97. Arrow-key nav between ordered steps.
98. "Next domain in the storyline" prev/next pager.

**The cross-domain storyline (first-class)**
99. Storyline view — linearize the longest cross-domain chain (push→build→deploy→billing) into one ribbon.
100. Cross-domain edge descriptions as hover cards (rich `description` is ignored today). **[K4]**
101. Edge weight → stroke thickness/opacity (the push→release spine reads as the spine). **[K4]**
102. Direction-aware arrows from the `direction` field. **[K4]**
103. "Play the storyline" timed narration of the business path.
104. Entry/terminal domain badges (no inbound = start, no outbound = end).

**Step → code → trace/structural/explain (the domain bridges)**
105. Step → open file at `lineRange` in `CodeViewer`.
106. Step → "Trace this code" (`startTraceAt` + trace view). **[K1/K3]**
107. Flow → "Trace the whole flow" (seed the trace with the flow's ordered steps).
108. Step → "Show in structural graph" (focus the file/function node).
109. Step → "Explain this" in business terms via `ExplainPanel`.
110. Build a `filePath → structuralNodeId` index once (powers 106/108). **[K1]**
111. "No code link" badge on steps whose file is null/missing (don't break trust silently).
112. `lineRange` enrichment pass in `/understand-domain` (most are null today).

**Search / entities / rules / quality**
113. Domain search bar (domains/flows/steps/entities) jumping to the match.
114. Filter by entity (`domainMeta.entities`) — highlight every flow/step touching it.
115. Business-rules panel in `NodeInfo` (full `businessRules`, not truncated).
116. Clickable entry-point chip on flows (opens the route handler) + `entryType` icon.
117. Entry-type legend & filter (http/cli/event/cron).
118. Entity glossary (which domains own/share each entity).
119. Filter domains by flow-count/complexity.
120. In-dashboard "refresh domain graph" (cheap derive path) + staleness vs structural.
121. Incremental single-domain refresh (`--domain <id>`).
122. Derivation-provenance badge (derived-from-graph vs lightweight-scan fidelity).
123. Domain coverage meter (% of files claimed by a domain) + "files in no domain" list.
124. Flow completeness/"stub" flags (0 steps or all-null filePath = likely hallucinated).

**Domain ↔ structural / onboarding**
125. "Show this domain's files in the graph" (structural view filtered to the domain's file set).
126. Reverse lookup — badge each file with the domain(s) that own it.
127. Domain overlay coloring on the structural graph (business meaning on the structure map).
128. "Start here" recommended domain for newcomers (highest-out-degree entry).
129. Domain tour ("take the tour of this domain") reusing the tour runner.
130. Persona-scoped domains (PM sees domains, not Dockerfiles).

## 4 · Onboarding, tours & teaching

**First-run / "where do I start?"**
131. Project-aware first-run overlay (generated from the graph, not static i18n steps).
132. "Pick your goal" first card routing to the right view (architecture / find X / role / explore).
133. "Start here" entry-point spotlight (tour-builder already computes entry candidates).
134. Empty-state coach marks on every panel ("what this does · try this").
135. 60-second auto "lay of the land" micro-tour.
136. "Resume where you left off" banner (persisted tour/exploration).

**Tours: progress, drift, branching, choreography**
137. Persisted tour progress + completion checkmarks (resets to step 0 today).
138. Tour drift detection — flag steps whose nodes changed, offer to re-anchor.
139. Branching tours ("go deeper into auth" vs "skip to API").
140. **Tour hops between views** — each step declares `view` (structural/domain/trace) and auto-switches. **[K1]**
141. Tour step → live trace launch.
142. Tour step → domain flow jump (teach the *why* alongside the *what*).
143. In-dashboard tour editor (drag-reorder, edit, save to `workspace.tours`).
144. "Build a tour from my bookmarks" (one click; ordered bookmarks → SavedTour).
145. Always-visible tour progress rail (dots even when LearnPanel is collapsed).
146. Per-step time + difficulty estimate.

**Persona / level / depth**
147. Persona-adapted tour depth (PM sees domain steps; senior gets a condensed version).
148. Persona picker surfaced *inside* onboarding (not a buried toolbar toggle).
149. Orthogonal "new to Go?" axis (expands every `languageLesson`) separate from role-seniority.
150. "Explain like I'm PM/junior/expert" depth switch on every explanation.
151. Three-altitude project summary (Elevator / Architecture / Deep-dive) via `claude -p`.
152. Per-layer "what / why / how" cards.
153. Progressive disclosure on nodes (summary → signature → full → trace).

**Curriculum / progress / retention**
154. Auto-generated curriculum from layers (foundations → core → features → infra).
155. Prerequisite graph for concepts ("grok Store before Reducer").
156. "Reading order" follow-the-imports mode (BFS-from-entry, one file at a time).
157. Role-based curriculum tracks (frontend/backend/PM/devops).
158. "You've explored X%" coverage meter (visited vs total, weighted by fan-in).
159. Coverage heat on the graph (the map fills in as you learn).
160. Per-layer coverage badges ("Core 80% · Infra 0%").
161. Onboarding checklist/milestones ("✓ took tour · ☐ traced a request").
162. End-of-tour knowledge check (3 architecture questions, app-wide — not the trace quiz).
163. Flashcard deck from bookmarks/glossary + spaced-review scheduler.
164. "Predict the dependency" challenge (no LLM — uses edges).

**Glossary / help / personal map**
165. Auto-built project glossary from `concept`/`domain` nodes, each linking to its node.
166. Go-idiom glossary (goroutines/channels/defer/embedding) with "show an example in this repo".
167. Hover-to-define jargon (dotted underline on terms in summaries/tours).
168. "Acronyms in this repo" auto-list defined in context.
169. AI onboarding chat that *routes you to the right view* (selects node / opens trace / switches to domain). **[K1]**
170. Context-sensitive help drawer (`?` changes content by active view).
171. First-encounter coach marks per view (one-time, tracked in workspace).
172. "What changed since I was last here?" recap on reload.
173. Just-in-time keyboard-shortcut hints ("tip: press → to advance").
174. Personal "knowledge map" from bookmarks + annotations, exportable as a cheat-sheet.

## 5 · Cross-feature integration & app-wide polish

**Unified selection & navigation**
175. Selection survives view switches (`setViewMode(mode,{keepSelection})`). **[K2]**
176. Canonical `focusEntity` all four views read/write. **[K1]**
177. Standard `<JumpActions nodeId/>` row everywhere (View-in-graph/Trace/Domain/Explain/Open-code). **[K3]**
178. Global breadcrumb across views (Domain ▸ flow ▸ trace ▸ code), clickable.
179. Browser back/forward = (view + selection) history.
180. Deep-linkable URLs encoding view+node+selection+trace config (token-in-query precedent exists).
181. "Copy link to this view" header button + toast.
182. Persistent right-side context panel that follows selection in *all* views (trace/knowledge lack it today).
183. Unified References panel promoted into that shared panel.

**Command palette & federated search**
184. Global command palette spanning views AND skills (run `/understand-domain`, regenerate, settings).
185. Federated search over structural + domain + symbols + steps with type badges.
186. Search-hit → best-view routing (flow→domain, function→trace, file→code+structural).
187. Recent & pinned destinations atop the palette.
188. Scoped search ("in this trace" / "in this domain").

**Trace ↔ everything (the core ask)**
189. Node → "Trace from here" on the node itself (not just the palette). **[K3]**
190. Trace hop → "part of: Payments flow" chip into the domain step (build `nodeIdToDomainStep`).
191. Trace hop → structural neighbors (preserve fold/mute as a return crumb).
192. Domain step → code → trace continuous drill-down.
193. Explain panel suggests the next hop ("Trace callers", "See in domain", "Next step in flow").
194. Goto-definition lands in the right view (function→trace if in trace, else structural).
195. File → "Start a tour here" (bridges onboarding into the other views).

**Cross-view diff on a PR**
196. Unified diff overlay across graph + domain + trace (one `useDiffOverlay` selector).
197. "What this PR changed" cross-view summary (N files · M flows · K call paths) with click-through.
198. Trace diff mode (added/removed hops as green/red rails) + diff-aware review deep-links.

**Shared `claude -p` UX & app-wide polish**
199. Shared explain cache (LRU by `path:start:end`+session) + abort-on-unmount + request queue + cost/latency surfacing + offline degradation + consistent "resume previous explanation". (`useCodeAssist` has no cache/AbortController today.)
200. App-wide consistency pass: keyboard reachability for the new jumps; ARIA live-region announcements on view/selection change; focus management across switches; theme-token audit for diff/trace colors (incl. light themes); mobile jump-actions + collapsible breadcrumb; a unified `<ViewState loading|empty|error|partial/>`; partial/stale-graph graceful degradation with the relevant skill action; and a single Settings modal consolidating persona/theme/depth/language/concurrency/landing-view persisted to `workspace.json`.

---

*Method: 5 parallel research agents (skill pipeline · structural · domain · onboarding · integration), each grounded in the real code and held distinct from the 50-trace catalog; synthesized + deduped. Recurring engineering seams: `store.ts` `setViewMode` resets selection (fix point for K2); `startTraceAt`/`navigateToDomain` already exist as jump primitives; `nodeIdToLayerId` indexing should be mirrored for domain/diff; `useCodeAssist.ts` is the single `claude -p` chokepoint; the analyzers already emit `weight`/`direction`/`description`/`lineRange`/`tags` the UI ignores.*

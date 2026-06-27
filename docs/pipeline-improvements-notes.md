# Skill / generation-pipeline improvements — implementation specs

Engineer-grade specs for the pipeline items (catalog 1–45) **not yet implemented** as code.
The shipped scripts (`scripts/dry-run.mjs`, `status.mjs`, `lint-ignore.mjs`, `quality-score.mjs`,
`safe-write-graph.mjs`) cover items 1, 7, 19, 20, 31, 42, 44. The rest are specced below.

## Cost & time estimation (items 9, 11, 12)
- **Pre-flight estimate** — after BATCH, before ANALYZE, print `batches × avg-files × historical-per-batch-ms`. Source the per-batch ms from `meta.json.batchTimings` (item 10). Surface `~N model calls · ~X min · ~Y tokens`.
- **`--budget <tokens>`** — track cumulative output tokens across file-analyzer dispatches; once exceeded, stop dispatching, write the partial graph + an `intermediate/unanalyzed.json` manifest, exit 0 with a "resume to finish" note.
- **`--concurrency N`** — replace the hardcoded 5-way fan-out in SKILL Phase 2 with a config/flag value (persist in `config.json`).

## Resume / recovery (items 16, 17, 18)
- **`--resume`** — in Phase 0, if `intermediate/batch-*.json` exist for some indices, skip those and re-dispatch only the missing `batchIndex` values, then merge. (Proven by hand during the full-index run — the merge script already tolerates a partial set.)
- **Quarantine-and-continue** — when a single file fails a batch twice, isolate it, emit a node with `analysisError`, continue, and recommend adding it to `.understandignore`.
- **`--batch <i>`** — re-dispatch one batch index, then re-merge. No full rebuild.

## Incremental correctness (items 25, 26, 27) — *highest value; classifier already written*
- Route the incremental path through `packages/core/src/change-classifier.ts` (`SKIP | PARTIAL_UPDATE | ARCHITECTURE_UPDATE | FULL_UPDATE`) instead of the coarse `git diff --name-only` re-analyze:
  - **SKIP** cosmetic-only diffs (whitespace/comments) — no batch spent.
  - **ARCHITECTURE_UPDATE** re-runs Phase 4 (layers) without re-analyzing files.
  - big churn auto-escalates to **FULL** with a heads-up.
- **Deleted/renamed pruning** — use `git diff --name-status`; for `D`/`R` statuses prune the file's nodes + incident edges from the graph (today they linger as orphans). A `scripts/classify-changes.mjs` wrapping the classifier would emit the decision + the prune list.

## Caching (items 22, 23, 24)
- Key `scan-result.json` on a hash of (file-tree + `.understandignore`) so it auto-invalidates when files are added/removed.
- Key fingerprints by content hash (not just commit) so branch switches reuse identical-file analysis.
- Under `--full`, reuse prior nodes/edges for fingerprint-unchanged files ("rebuild structure, reuse stable analysis").

## Progress / observability (items 13, 14, 15)
- **`progress.json`** — Phase 2 writes `{phase, batchesDone, batchesTotal, currentFiles, startedAt, failures[]}` each batch; the dashboard polls it and shows an "indexing… (N/M, ~ETA)" banner so the graph can be opened *while* it builds.
- ETA in the batch progress line from rolling completed-batch timings.

## Auto-update (items 32, 33, 34)
- `--auto-update` should install an idempotent, clearly-marked git `post-commit` hook that runs the incremental update in the background (today the flag only writes config, with no executor). Debounce via the classifier (only run on structural change above a threshold); write a one-line result to `progress.json` the dashboard can surface.

## Multi-language / monorepo (items 35, 36, 37, 38)
- Group batches by dominant language in `compute-batches.mjs` so each file-analyzer gets single-language context (`languages/<id>.md`).
- Auto-detect workspaces (`pnpm-workspace.yaml`, `go.work`, Cargo/lerna) → generate one sub-graph per package (`<pkg>-knowledge-graph.json`) that `merge-subdomain-graphs.py` already merges; stitch cross-package imports on merge; allow parallel `--package <name>` builds + a final `--merge`.

## Cheaper domain/knowledge graphs (items 39, 40, 41)
- Incremental domain-graph: only re-derive when the knowledge graph's commit advanced.
- Auto-refresh the domain graph after `/understand` when one already exists (cheap derive path).
- Share the preserved `scan-result.json` across the understand/domain/onboard skills instead of re-scanning.

## Config (item 45)
- Write a commented `config.json` scaffold on first run; add `--config` to print current settings + available keys (`autoUpdate`, `outputLanguage`, `concurrency`, `scopes`, `maxTokens`).

---
*Grounding: `change-classifier.ts` + `fingerprint.ts` + `staleness.ts` already exist in `packages/core/src` and are largely unused by `SKILL.md` — items 25–27 and 31 are mostly **wiring**, not new code.*

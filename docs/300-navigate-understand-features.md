# 300-series — Deep navigate-and-understand features (entrypoints · tests · data · errors · inspector)

121 features to understand *any* app beyond the call/import graph — each is **either a UI affordance or a "graph-connection opportunity"** (a new node/edge type the analyzer emits). Researched against Sourcegraph, Swagger/Postman, Backstage, C4, Rails/Django route tooling, Codecov/Wallaby/Stryker, SonarQube/CodeScene, CodeQL/Snyk/Semgrep, dbdiagram/Prisma/Atlas/Azimutt, OpenLineage/dbt/DataHub, Sentry, OpenTelemetry/Honeycomb/Datadog/Jaeger, resilience4j/Polly/Istio/Temporal, Chrome DevTools, VS Code, IntelliJ, Figma. Distinct from `50-interactive-trace-features.md` and `200-ux-improvements.md`.

> **The keystone (flagged by every stream): the `used_by` join.** Every catalog ecosystem (ERD, coverage, lineage, OTel, Sentry) stops at its own boundary. The unique value here is linking each operations-layer node back to the exact code node that reads/writes/gates/raises/tests it, in ONE graph. Build the join first; the views below are projections of it.

---

## 1 · Entrypoints, API surface & control flow
1. **Front Door Index** — auto-detected catalog of every entry (main, HTTP handler, CLI cmd, cron, queue consumer, webhook, gRPC, lambda) as one grouped panel · *graph: `endpoint` node + `kind`*.
2. **`exposes_api`/`handles_route` edges** — entrypoint → implementing fn as a real edge · *graph*.
3. **API/Route Map** — `method · path · handler` table, each row drilling into the handler · *UI*.
4. **Tag/resource grouping** — routes in collapsible accordions by resource/tag · *UI*.
5. **CLI command tree** — cmd/subcommand hierarchy (cobra/click/clap), leaves → handlers · *graph: `command` + `subcommand_of`*.
6. **gRPC/RPC service catalog** — `service → method` index parallel to REST · *graph: `rpc_method`*.
7. **Cron/scheduled-job catalog** — every scheduled task + cadence + target · *graph: `schedule` + `triggers`*.
8. **Trigger/event-source column** — what fires each endpoint (S3, schedule, SNS…) · *graph: `triggered_by`*.
9. **Event-bus producer↔consumer map** — Kafka/SQS/Rabbit topic nodes linking emitters→consumers · *graph: `event`/`topic` + `emits_event`/`consumes_event`*.
10. **Orphan-topic / dangling-consumer detector** — produced-never-consumed & consumed-never-produced · *graph analysis*.
11. **Webhook producer↔receiver edges** — outbound emitter → inbound handler route (cross-repo by URL) · *graph*.
12. **Reachable-from-entrypoint highlight** — pick an entry → dim everything not transitively reachable · *UI + `reachable_from`*.
13. **"Why is this live?" path tracer** — shortest entry→fn chain, static vs dynamic hops labeled · *UI*.
14. **Dead-code overlay** — complement of all reachable sets, with certain/test-only/maybe-dynamic confidence · *UI*.
15. **Test-only reachability flag** — alive-in-tests-dead-in-prod distinction · *graph attr + toggle*.
16. **Unused-exports / orphan-files report** — mark-and-sweep over `imports`, jump-to · *UI report*.
17. **Attack-surface / blast-radius badge** — # distinct entrypoints whose reachable set includes this node · *UI metric*.
18. **Middleware onion / request-pipeline** — ordered request→mw[0..n]→router→handler→response for an endpoint · *graph: ordered `passes_through`*.
19. **Short-circuit / branch edges** — early-exit (auth reject, `next(err)`) as distinct bypass edges · *graph: `short_circuits`*.
20. **Endpoint-rooted trace overlay** — seed a trace from an endpoint; reconcile static vs observed runtime · *UI bridge*.
21. **Public-surface vs internal partition** — `visibility` from exports + modifiers + release tags; "public only" view · *graph attr + filter*.
22. **API-surface snapshot & diff** — committable public-signature listing diffed across commits, breaking-vs-compatible · *report + diff*.
23. **Models/Schema section** — request/response shapes mapped to class nodes + which endpoints use each · *graph: `serializes`/`returns`*.
24. **Cross-service provides/consumes edges** — module↔module from route defs + client calls · *graph: `provides_api`/`consumes_api`*.
25. **C4 boundary/zoom levels** — System→container→file→function nested boxes, collapse-folder-to-node · *UI*.
26. **Architecture boundary rules** — declare forbidden/allowed layer edges; flag violations · *rule engine over `imports`*.
27. **Circular-dependency detector** — import cycles in red + cycles-only subgraph · *derived attr + filter*.
28. **Route → domain-flow bridge** — `POST /orders` links into the "Place Order" domain flow · *graph: `triggers`(route→flow)*.
29. **Env/config-read overlay on endpoints** — env vars an endpoint's path reads, as chips · *graph: `reads_config`*.
30. **Reachability-aware `claude -p` prompts** — feed each node its entrypoint-of-origin + why-live path so explanations say "runs when /checkout is hit" · *data affordance*.

## 2 · Tests, coverage & quality/security
31. **`Test`/`Suite` node type** — test fns + suite parents as nodes (framework/status/duration/flaky) · *graph*.
32. **`tested_by`/`covers` edge (bidirectional, weighted)** — the load-bearing reverse query "what covers this fn" · *graph keystone*.
33. **`Finding` node (smell/bug/vuln/hotspot/mutant)** — one model spanning Sonar/CodeQL/Snyk/mutants, SARIF-shaped · *graph*.
34. **`Fixture`/`Mock` node + `uses_fixture`** — "what's faked when this passes" + shared-fixture blast radius · *graph*.
35. **`temporal_coupling` edge** — files that co-change with no static edge (from git log) · *graph (dashed arcs)*.
36. **`asserts_on` edge** — each assertion → the symbol/value it checks · *graph*.
37. **`duplicates` edge** — clone blocks across files · *graph*.
38. **Per-node quality attributes** — complexity/churn/coverage%/mutationScore/health/ownership rolled up via `contains` · *graph attrs*.
39. **Tri-state coverage overlay** — covered/uncovered/partial on the graph + folder aggregates · *UI*.
40. **"N tests cover this" badge + click-to-list** — covering-test count, click → list, each a jump · *UI*.
41. **Jump-to-test ⇄ jump-to-code** — bidirectional, re-roots the graph · *UI*.
42. **Coverage treemap/sunburst** — size=LOC, color=coverage% (or any metric), drill · *UI*.
43. **Coverage gutter in code viewer** — per-line covered/partial stripes + exec-count + branch arms · *UI*.
44. **Test Explorer side-panel** — suite→test tree, filter failing/slow, run/trace/explain a test · *UI*.
45. **"Changing X → run these tests"** — reverse `covers` closure + copyable `--findRelatedTests` cmd · *UI + cmd*.
46. **Patch / project / indirect coverage on a PR** — incl. *indirect* (ripple) coverage shifts · *UI overlay*.
47. **Untested-impact warning on diff hops** — changed hop with zero covering tests → red · *UI badge*.
48. **Churn × complexity hotspot quadrant** — upper-right = refactor priority, click-through · *UI chart*.
49. **"Untested complex code" risk overlay** — complexity × (1−coverage) heat + preset · *UI*.
50. **Circle-packing "city" map + coupling arcs** — LOC size, health color, `temporal_coupling` arcs · *UI*.
51. **Ownership / bus-factor overlay** — main-author %, single-owner-hotspot flags, off-boarding recolor · *UI + `owned_by`*.
52. **Metric trend insight cards** — any node-metric over git history, drill to "N nodes match" · *UI*.
53. **Mutation-score overlay + surviving-mutant markers** — original→mutated drawer + killing test · *UI + `mutant`/`killed_by`*.
54. **Tainted dataflow path overlay** — source→sink ordered step-list across the call graph (SARIF codeFlows) · *UI*.
55. **Vulnerable-dependency highlight + "introduced through" path** — vuln pkg + reachable call path · *UI + `flags_vuln`*.
56. **Security-hotspot review overlay** — to-review→safe/fixed workflow on sensitive nodes · *UI + status*.
57. **Flaky & slow test surfacing** — badges + "flaky tests cover this fn" warning · *UI + Test attrs*.
58. **Assertion/expectation navigator** — what behavior is *verified* vs merely executed · *UI + `asserts_on`*.
59. **Fixture/mock dependency graph** — fixture fan-out + what each mock replaces · *UI*.
60. **"Test Story" linear execution view** — one test's reading-order ribbon across the codebase · *UI (trace renderer)*.

## 3 · Data, database & config
61. **Schema-as-graph extraction** — migrations/schema.rb/prisma → `table`/`column` nodes + `foreign_key` edges · *graph*.
62. **ERD subgraph projection** — a new "Data" view of tables/columns/FKs, exportable · *UI view mode*.
63. **Attribute-visibility levels** — all-columns / keys-only / table-names-only · *UI*.
64. **N-hops table neighborhood explorer** — expand related tables by FK, in/out, degree slider · *UI*.
65. **Inferred FK edges by naming** — `user_id`→`users.id` as dashed `inferred_fk` · *graph + confidence*.
66. **Schema anomaly linter** — missing-FK/no-PK/god-table/type-mismatch/unindexed-hot · *UI findings*.
67. **Find-path between two tables** — all FK join routes across hops · *UI*.
68. **Colored schema groups** — tables grouped by schema/bounded-context, foldable · *UI*.
69. **Model↔table overlay** — ORM model → resolved table+columns · *graph: `maps_to_table`/`has_column`*.
70. **Association edge extraction** — has_many/belongs_to/GORM tags/relationship() with cardinality · *graph: `has_association`*.
71. **`used_by`: what code reads/writes a column** — the keystone data↔code bridge · *graph*.
72. **Read/write directionality on query edges** — `reads_table` (SELECT) vs `writes_table` (mutation) · *graph*.
73. **Function→table query map** — every SQL tied to its fn:line · *graph: `queries_table`*.
74. **Raw-SQL string extraction** — parse SQL in string literals (no ORM needed) · *graph*.
75. **Normalized `query` node identity** — literals→`$1` so one parameterized query = one node · *graph*.
76. **Hot-query ranking + heat** — call-count/exec-time/rows (optional runtime pass), top-offenders panel · *UI*.
77. **N+1 / runs-in-loop annotation** — per-parent or in-loop queries + eager-load fix hint · *graph + UI*.
78. **Optional runtime query harvester** — hook ORM stream in a test run, merge actual SQL · *graph enrich*.
79. **Transaction-boundary nodes** — atomic write-sets + lock scope · *graph: `transaction`/`opens_transaction`*.
80. **Orphan/dead-table analytics** — write-only/stale/zero-callsite tables · *graph analysis*.
81. **Migration history DAG + "schema at commit X"** — revision DAG + timeline scrubber replay · *UI + `migration`*.
82. **Migration→schema-target edges** — structured ops (creates_table/alters_column) on specific nodes · *graph*.
83. **Schema diff + destructive-change lint** — added/dropped/altered A→B with risk codes · *UI diff*.
84. **Field-level data lineage** — `derives_from` between `field` nodes, transform-typed, masking flag · *graph + UI*.
85. **Column blast-radius** — full downstream break-set if a column changes, column-precision · *UI*.
86. **Config usage map** — `env_var` nodes + `reads_config` from every read site; required-vs-optional, red = required-no-default · *graph + UI*.
87. **Config drift/coverage diff** — code-reads vs `.env.example` vs schema: undocumented/orphaned/missing · *UI*.
88. **Feature-flag→code map + dead-flag detection** — `gated_by_flag` edges, ref-count 0 → "ready for removal" · *graph + UI*.
89. **Secrets surface with liveness + provenance** — `secret` nodes, verified state, `introduced_by`→commit→author · *graph*.
90. **Cache writer↔invalidator map** — `caches`/`reads_cache`/`invalidates` over `cache_key`; write-without-bust flag · *graph*.
91. **Queue/topic topology + payload schema** — `topic` nodes + publish/subscribe + versioned `payload_schema` evolution · *graph + UI*.

## 4 · Errors, observability & resilience
92. **`error_type` nodes + `raises`/`handles`/`wraps`** — the implicit error contract made queryable · *graph*.
93. **"This function can fail with…" panel** — transitive uncaught error types that actually escape · *UI*.
94. **Error-propagation blast-radius overlay** — for an error type, every raise→…→handle path (static stack trace) · *UI*.
95. **Swallowed-error markers** — empty/log-only/broad catches, ignored `_ =` returns · *graph `swallows` + badge*.
96. **Fault-domain shading** — regions bounded by the nearest enclosing handler · *UI*.
97. **panic/recover & error-return edges (Go)** — `recovers` edge + `error_path` tagged return/wrap/log/swallow · *graph*.
98. **HTTP status-code → handler map** — "everywhere that can return a 5xx" · *graph + filter*.
99. **`log_site` nodes + `logs` edges** — severity/template/fields; "logs this fn emits" tab · *graph*.
100. **Runtime-log-line → code resolver** — paste a log line, fuzzy-match templates, jump to emitter · *UI*.
101. **`span_site` nodes + `instruments`/`enriches_span`** — where trace boundaries + business context attach · *graph*.
102. **Instrumentation-coverage heat** — green=span, amber=auto-only, red=telemetry-dark · *UI*.
103. **`metric` nodes + `emits_metric`** — "which fn increments orders_total / what does this measure" · *graph*.
104. **`code.*` OTel semantic anchor** — canonical join key so runtime spans/exemplars resolve to nodes · *graph (join key)*.
105. **Metric→span→code exemplar drill** — static replica of OTel exemplar navigation · *UI*.
106. **Static service/dependency-map projection** — boundary-crossing calls/imports collapsed to a service map · *UI zoom*.
107. **SLO/alert → owning-code overlay** — `alert`/`slo` nodes + `alerts_on` reaching the emitting fn · *graph + UI*.
108. **Resilience badges on `calls` edges** — ↻ retry / ⊘ breaker / ⏱ timeout / ▥ bulkhead / ⇄ fallback · *graph `resilience[]` + UI*.
109. **`ResiliencePolicy` nodes + `wraps`** — reconnect decoupled config (Istio/DI) to guarded call sites · *graph*.
110. **Breaker state-machine inspector** — closed→open→half-open with extracted thresholds · *UI tab*.
111. **Timeout/deadline budget-propagation** — trace `ctx` deadlines; flag `context.Background()` chain breaks + retry-storm multiplication · *UI overlay*.
112. **Resilience-coverage audit lens** — rank external calls protected→partial→naked, with covering policy · *UI lens + table*.
113. **Async safety-net edges** — `compensates` (saga rollback order), `dead_letters_to` (DLQ) · *graph*.

## 5 · The deep inspector / sidebar
114. **Structure (outline) tab** — selected node's internal symbol tree, sortable, filter box, problem badges · *UI*.
115. **Usages tab grouped by kind** — call/import/instanceof/override grouped by directory, read/write toggle · *UI*.
116. **Inline peek/preview sub-pane** — reference snippet docked *inside* the inspector, prev/next, graph stays put · *UI*.
117. **History / git-blame / Timeline tab** — commits + blame + churn sparkline + "suspect commit" chip · *UI + node meta*.
118. **Owners / CODEOWNERS tab** — owner chips + matched rule + "who to ask"; filter team's code · *UI + `owns`*.
119. **Related Tests & Related Docs tabs** — `tested_by` cases + co-located docs/runbooks, jump to either · *UI + edges*.
120. **Computed/derived-properties pane** — fan-in/out, complexity, dep depth, public-surface, errors-that-escape — each expandable to "why" · *UI*.
121. **Breadcrumb + sibling dropdowns + pin-to-compare** — lateral hops, tab overflow, detach a 2nd inspector side-by-side · *UI*.

---

## Appendix — the operations-layer schema (new node + edge types)
A second graph layer above the existing file/function/class **code layer**, bridged by `used_by`/`owns`/`part_of`/`exposes_endpoint`/`depends_on` — this is the zoom-out capability Backstage/Datadog center their UI on, and it extends this project's structural↔domain split.

**Node-types:** `endpoint`/`route` · `command`/`rpc_method` · `schedule` · `event`/`topic`/`queue` · `api` · `test`/`suite`/`fixture` · `finding`/`mutant` · `table`/`column`/`model`/`field` · `query`/`transaction`/`migration` · `env_var`/`config`/`feature_flag`/`secret`/`cache_key` · `error_type` · `log_site`/`span_site`/`metric` · `owner`/`team` · `service`/`system` · `doc`/`runbook` · `alert`/`slo` · `ResiliencePolicy` · `payload_schema`.

**Edge-types:** `handles_route`/`exposes_api`/`provides_api`/`consumes_api` · `emits_event`/`consumes_event`/`triggered_by`/`subcommand_of` · `reachable_from`/`passes_through`(ordered)/`short_circuits` · `tested_by`/`covers`/`asserts_on`/`uses_fixture`/`temporal_coupling`/`duplicates` · `flags_vuln`/`killed_by` · `foreign_key`/`inferred_fk`/`maps_to_table`/`has_column`/`has_association` · `queries_table`/`reads_table`/`writes_table`/`runs_in_loop`/`opens_transaction`/`migrates` · `derives_from`/`flows_to` · `reads_config`/`gated_by_flag`/`secret_in_file`/`caches`/`reads_cache`/`invalidates`/`publishes_to`/`subscribes_to` · `raises`/`handles`/`wraps`/`swallows`/`recovers`/`error_path` · `logs`/`instruments`/`enriches_span`/`emits_metric` · `alerts_on` · `owns`/`owned_by`/`documents`/`part_of`/`depends_on`.

**Three cheap static extractors populate ~all of them:** (1) declarative metadata (decorators/annotations/DSL/YAML/OpenAPI/CODEOWNERS); (2) string-literal args to a known call (flag keys, topic/table names, FK targets); (3) AST statement classification (SELECT vs INSERT, raise vs catch, `logger.<level>`, test-file globs). Design node identities to match **OTel semantic-convention values** (`http.route`, `db.collection.name`, `messaging.destination.name`) so real runtime telemetry attaches to the static graph for free.

## Highest payoff-to-effort first sprint
**The `used_by` join (32, 71, 73, 86, 92, 99)** + **Front Door Index (1–3)** + **reachable/dead-code (12–14)** + **tri-state coverage overlay (39–41)** + **the multi-tab inspector (114–121)** — these answer the four questions a newcomer actually asks: *where does the world come in · what's tested · where does the data go · what can fail* — and the inspector is your "deepen the sidebar" ask, realized.

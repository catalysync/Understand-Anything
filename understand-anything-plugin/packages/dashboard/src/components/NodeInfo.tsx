import { useState } from "react";
import type { ReactNode } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import type { NodeType, KnowledgeGraph, GraphNode } from "@understand-anything/core/types";
import {
  opsLayerForNode,
  nodeTypeIcon,
  routeIdentity,
  coveringTestsForNode,
  codeUnderTest,
  dataFootprint,
  envVarsForCode,
  impactedTests,
  observabilityFor,
  logSiteDetail,
  uncaughtErrorsFor,
  raiseSites,
  handlerSites,
  swallowedErrorsFor,
  CODE_TYPES,
} from "../utils/opsLayer";
import JargonText from "./JargonText";

// Badge color classes keyed by NodeType — must be kept in sync with core NodeType union.
const typeBadgeColors: Record<NodeType, string> = {
  file: "text-node-file border border-node-file/30 bg-node-file/10",
  function: "text-node-function border border-node-function/30 bg-node-function/10",
  class: "text-node-class border border-node-class/30 bg-node-class/10",
  module: "text-node-module border border-node-module/30 bg-node-module/10",
  concept: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  config: "text-node-config border border-node-config/30 bg-node-config/10",
  document: "text-node-document border border-node-document/30 bg-node-document/10",
  service: "text-node-service border border-node-service/30 bg-node-service/10",
  table: "text-node-table border border-node-table/30 bg-node-table/10",
  endpoint: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  pipeline: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  schema: "text-node-schema border border-node-schema/30 bg-node-schema/10",
  resource: "text-node-resource border border-node-resource/30 bg-node-resource/10",
  domain: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  flow: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  step: "text-node-function border border-node-function/30 bg-node-function/10",
  article: "text-node-article border border-node-article/30 bg-node-article/10",
  entity: "text-node-entity border border-node-entity/30 bg-node-entity/10",
  topic: "text-node-topic border border-node-topic/30 bg-node-topic/10",
  claim: "text-node-claim border border-node-claim/30 bg-node-claim/10",
  source: "text-node-source border border-node-source/30 bg-node-source/10",
  // ── Operations layer (300-series) ──────────────────────────────────────
  route: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  command: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  event: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  schedule: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  api: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  column: "text-node-table border border-node-table/30 bg-node-table/10",
  model: "text-node-table border border-node-table/30 bg-node-table/10",
  query: "text-node-table border border-node-table/30 bg-node-table/10",
  transaction: "text-node-table border border-node-table/30 bg-node-table/10",
  migration: "text-node-table border border-node-table/30 bg-node-table/10",
  cache_key: "text-node-table border border-node-table/30 bg-node-table/10",
  payload_schema: "text-node-table border border-node-table/30 bg-node-table/10",
  test: "text-node-test border border-node-test/30 bg-node-test/10",
  suite: "text-node-test border border-node-test/30 bg-node-test/10",
  fixture: "text-node-test border border-node-test/30 bg-node-test/10",
  finding: "text-node-finding border border-node-finding/30 bg-node-finding/10",
  error_type: "text-node-error border border-node-error/30 bg-node-error/10",
  env_var: "text-node-config-ops border border-node-config-ops/30 bg-node-config-ops/10",
  feature_flag: "text-node-config-ops border border-node-config-ops/30 bg-node-config-ops/10",
  secret: "text-node-config-ops border border-node-config-ops/30 bg-node-config-ops/10",
  log_site: "text-node-observability border border-node-observability/30 bg-node-observability/10",
  span_site: "text-node-observability border border-node-observability/30 bg-node-observability/10",
  metric: "text-node-observability border border-node-observability/30 bg-node-observability/10",
  alert: "text-node-observability border border-node-observability/30 bg-node-observability/10",
  owner: "text-node-owner border border-node-owner/30 bg-node-owner/10",
  doc: "text-node-document border border-node-document/30 bg-node-document/10",
};

const complexityBadgeColors: Record<string, string> = {
  simple: "text-node-function border border-node-function/30 bg-node-function/10",
  moderate: "text-accent-dim border border-accent-dim/30 bg-accent-dim/10",
  complex: "text-[#c97070] border border-[#c97070]/30 bg-[#c97070]/10",
};

function getDirectionalLabel(edgeType: string, isSource: boolean, t: ReturnType<typeof useI18n>["t"]): string {
  // edgeLabels covers the structural/domain/knowledge edge types; operations-layer
  // (300-series) edge types fall through to the humanized-name formatter below.
  const labels = (t.edgeLabels as Record<string, { forward: string; backward: string }>)[edgeType];
  if (!labels) {
    const formatted = edgeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return isSource ? formatted : `${formatted} (reverse)`;
  }
  return isSource ? labels.forward : labels.backward;
}

function KnowledgeNodeDetails({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const { t } = useI18n();
  const meta = node.knowledgeMeta;

  // Wikilinks (outgoing related edges)
  const wikilinks = graph.edges
    .filter((e) => e.type === "related" && e.source === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  // Backlinks (incoming related edges)
  const backlinks = graph.edges
    .filter((e) => e.type === "related" && e.target === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n): n is GraphNode => n !== undefined);

  // Category
  const categoryEdge = graph.edges.find(
    (e) => e.type === "categorized_under" && e.source === node.id
  );
  const categoryNode = categoryEdge
    ? graph.nodes.find((n) => n.id === categoryEdge.target)
    : null;

  return (
    <div className="space-y-3">
      {categoryNode && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.category}</h4>
          <button
            type="button"
            onClick={() => navigateToNode(categoryNode.id)}
            className="text-[11px] px-2 py-0.5 rounded bg-elevated text-accent hover:text-accent-bright transition-colors"
          >
            {categoryNode.name}
          </button>
        </div>
      )}
      {meta?.wikilinks && meta.wikilinks.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t.nodeInfo.wikilinks} ({wikilinks.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {wikilinks.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => navigateToNode(n.id)}
                className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors truncate"
              >
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {backlinks.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            {t.nodeInfo.backlinks} ({backlinks.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {backlinks.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => navigateToNode(n.id)}
                className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors truncate"
              >
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {meta?.content && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.common.preview}</h4>
          <div className="text-[11px] text-text-secondary leading-relaxed bg-elevated rounded-lg p-3 max-h-[300px] overflow-auto whitespace-pre-wrap font-mono">
            {meta.content.slice(0, 1500)}
            {meta.content.length > 1500 && (
              <span className="text-text-muted">... {t.common.truncated}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DomainNodeDetails({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const { t } = useI18n();
  const meta = node.domainMeta;

  if (node.type === "domain") {
    const flows = graph.edges
      .filter((e) => e.type === "contains_flow" && e.source === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => n !== undefined);

    return (
      <div className="space-y-3">
        {Array.isArray(meta?.entities) && meta.entities.length > 0 ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.entities}</h4>
            <div className="flex flex-wrap gap-1">
              {meta.entities.map((e) => (
                <span key={e} className="text-[11px] px-2 py-0.5 rounded bg-elevated text-text-secondary">{e}</span>
              ))}
            </div>
          </div>
        ) : null}
        {Array.isArray(meta?.businessRules) && meta.businessRules.length > 0 ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.businessRules}</h4>
            <ul className="text-[11px] text-text-secondary space-y-1">
              {meta.businessRules.map((r, i) => (
                <li key={i} className="flex gap-1.5"><span className="text-accent shrink-0">-</span>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {Array.isArray(meta?.crossDomainInteractions) && meta.crossDomainInteractions.length > 0 ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.crossDomain}</h4>
            <ul className="text-[11px] text-text-secondary space-y-1">
              {meta.crossDomainInteractions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {flows.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.flows}</h4>
            <div className="space-y-1">
              {flows.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { navigateToDomain(node.id); selectNode(f.id); }}
                  className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors"
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (node.type === "flow") {
    const steps = graph.edges
      .filter((e) => e.type === "flow_step" && e.source === node.id)
      .sort((a, b) => a.weight - b.weight)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => n !== undefined);

    return (
      <div className="space-y-3">
        {meta?.entryPoint ? (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.entryPoint}</h4>
            <div className="text-[11px] font-mono text-accent">{meta.entryPoint}</div>
          </div>
        ) : null}
        {steps.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.steps}</h4>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selectNode(s.id)}
                    className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] transition-colors"
                  >
                    <span className="text-accent/60 mr-1.5">{i + 1}.</span>
                    <span className="text-text-secondary hover:text-accent">{s.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  if (node.type === "step") {
    if (!node.filePath) return null;
    return <DomainStepDetails node={node} />;
  }

  return null;
}

/**
 * Features 110/105/106: a domain step's implementation panel — resolves the
 * step's filePath to a structural node, exposing "Open file" and
 * "Trace this code". Badges a step whose file is missing from the structural
 * graph (and notes when only a filePath, not a lineRange, is known).
 */
function DomainStepDetails({ node }: { node: GraphNode }) {
  const { t } = useI18n();
  const filePathToNodeId = useDashboardStore((s) => s.filePathToNodeId);
  const openStepFile = useDashboardStore((s) => s.openStepFile);
  const traceStepCode = useDashboardStore((s) => s.traceStepCode);

  const fp = node.filePath!;
  const resolved = filePathToNodeId.has(fp);

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t.nodeInfo.implementation}</h4>
        <div className="text-[11px] font-mono text-text-secondary break-all">
          {fp}
          {node.lineRange ? (
            <span className="text-text-muted">:{node.lineRange[0]}-{node.lineRange[1]}</span>
          ) : (
            <span className="ml-1 text-[9px] uppercase tracking-wider text-text-muted/70">(file-level)</span>
          )}
        </div>
      </div>
      {resolved ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openStepFile(node.id)}
            className="flex-1 px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors"
          >
            {"{} "}Open file
          </button>
          <button
            type="button"
            onClick={() => traceStepCode(node.id)}
            className="flex-1 px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 text-[11px] text-text-secondary hover:text-accent transition-colors"
          >
            ▶ Trace this code
          </button>
        </div>
      ) : (
        <div className="px-2 py-1.5 rounded bg-[#c97070]/10 border border-[#c97070]/30 text-[10px] text-[#c97070]">
          ⚠ File not found in the structural graph — cannot open or trace.
        </div>
      )}
    </div>
  );
}

/**
 * The KEYSTONE cross-layer panel. When a code node is selected this lists the
 * operations-layer nodes it backs (routes it handles, tables it queries, errors
 * it raises, tests covering it, config it reads …) grouped by relation. When an
 * ops-layer node is selected it shows the code nodes that define/use it. Each
 * row jumps via focusEntity; a "Trace" affordance starts a trace at the target.
 */
function OpsLayerSection({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);
  const groups = opsLayerForNode(graph, node.id);
  if (groups.length === 0) return null;

  return (
    <div className="mb-4 space-y-3">
      <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">
        Operations layer
      </h3>
      {groups.map((g) => (
        <div key={`${g.label}-${g.edgeType}`}>
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
            {g.label} ({g.rows.length})
          </h4>
          <div className="space-y-1.5">
            {g.rows.map((row) => {
              const { method, path } = routeIdentity(row.node);
              const rowBadge = typeBadgeColors[row.node.type as NodeType] ?? typeBadgeColors.file;
              return (
                <div
                  key={`${g.edgeType}-${row.node.id}`}
                  className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle flex items-center gap-2 group"
                >
                  <span className="shrink-0" aria-hidden>{nodeTypeIcon(row.node.type)}</span>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${rowBadge}`}>
                    {row.node.type}
                  </span>
                  <button
                    type="button"
                    onClick={() => focusEntity(row.node.id)}
                    className="flex-1 min-w-0 text-left text-text-primary truncate hover:text-accent transition-colors"
                    title={`Jump to ${row.node.name}`}
                  >
                    {method && (
                      <span className="font-mono text-[10px] text-node-endpoint mr-1.5">{method}</span>
                    )}
                    <span>{path ?? row.node.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startTraceAt(row.node.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/30 text-accent hover:text-accent-bright transition-all"
                    title="Trace from here"
                  >
                    ▶
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Route/endpoint method · path metadata strip for entrypoint nodes. */
function OpsMetaBadges({ node }: { node: GraphNode }) {
  const { method, path } = routeIdentity(node);
  if (!method && !path && !node.kind && !node.severity) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px]">
      {method && (
        <span className="font-mono font-semibold px-2 py-0.5 rounded bg-node-endpoint/10 text-node-endpoint border border-node-endpoint/30">
          {method}
        </span>
      )}
      {path && (
        <span className="font-mono px-2 py-0.5 rounded bg-elevated text-text-secondary border border-border-subtle truncate max-w-full" title={path}>
          {path}
        </span>
      )}
      {node.kind && (
        <span className="px-2 py-0.5 rounded bg-elevated text-text-muted border border-border-subtle">
          {node.kind}
        </span>
      )}
      {node.severity && (
        <span className="px-2 py-0.5 rounded bg-[#c97070]/10 text-[#c97070] border border-[#c97070]/30 uppercase tracking-wider">
          {node.severity}
        </span>
      )}
    </div>
  );
}

/**
 * 300-series items 40-41 & 45: Tests section. For a code node it shows the
 * covering-test count, a click-to-list of `test` nodes (each jumps), a
 * "Go to tests" action, and a "Show test-impact" toggle (item 45). For a `test`
 * node it shows a "Go to code under test" action listing the covered code.
 */
function TestsSection({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const setTestImpactRoot = useDashboardStore((s) => s.setTestImpactRoot);
  const testImpactRootId = useDashboardStore((s) => s.testImpactRootId);
  const [open, setOpen] = useState(false);

  const isCode = CODE_TYPES.has(node.type);
  const isTest = node.type === "test" || node.type === "suite";

  const coveringTests = isCode ? coveringTestsForNode(graph, node.id) : [];
  const covered = isTest ? codeUnderTest(graph, node.id) : [];
  const impactCount = isCode ? impactedTests(graph, [node.id]).length : 0;

  if (!isCode && !isTest) return null;
  if (isCode && coveringTests.length === 0 && impactCount === 0) return null;
  if (isTest && covered.length === 0) return null;

  const impactActive = testImpactRootId === node.id;

  return (
    <div className="mb-4 space-y-2">
      <h3 className="text-[11px] font-semibold text-node-test uppercase tracking-wider">
        Tests
      </h3>

      {/* Code node: "N tests cover this" badge + jump-to-tests + impact */}
      {isCode && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-node-test/40 bg-node-test/10 text-node-test hover:bg-node-test/20 transition-colors"
              title="List covering tests"
            >
              <span aria-hidden>✓</span>
              {coveringTests.length} test{coveringTests.length === 1 ? "" : "s"} cover this
              <span className="opacity-70">{open ? "▴" : "▾"}</span>
            </button>
            {impactCount > 0 && (
              <button
                type="button"
                onClick={() => setTestImpactRoot(impactActive ? null : node.id)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                  impactActive
                    ? "border-[#d4a574]/60 bg-[#d4a574]/15 text-[#d4a574]"
                    : "border-border-subtle text-text-muted hover:text-[#d4a574] hover:border-[#d4a574]/40"
                }`}
                title="Highlight the tests impacted by changing this node (item 45)"
              >
                {impactActive ? "✓ " : ""}Impact: {impactCount} test{impactCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
          {open && coveringTests.length > 0 && (
            <div className="space-y-1">
              {coveringTests.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => focusEntity(t.id, { view: "structural" })}
                  className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-node-test/40 text-left transition-colors"
                  title={`Jump to ${t.name}`}
                >
                  <span className="text-node-test shrink-0" aria-hidden>✓</span>
                  <span className="text-text-primary truncate flex-1">{t.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Test node: jump to code under test */}
      {isTest && covered.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Code under test ({covered.length})
          </div>
          {covered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => focusEntity(c.id, { view: "structural" })}
              className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-accent/40 text-left transition-colors"
              title={`Go to ${c.name}`}
            >
              <span className="shrink-0" aria-hidden>{nodeTypeIcon(c.type)}</span>
              <span className="text-text-primary truncate flex-1">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 300-series items 71-73: Data footprint. Lists the tables/columns a code node
 * reads/writes (with read/write directionality) and the env vars it reads.
 */
function DataFootprintSection({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  if (!CODE_TYPES.has(node.type)) return null;

  const tables = dataFootprint(graph, node.id);
  const envVars = envVarsForCode(graph, node.id);
  if (tables.length === 0 && envVars.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      <h3 className="text-[11px] font-semibold text-node-table uppercase tracking-wider">
        Data
      </h3>
      {tables.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Tables / columns ({tables.length})
          </div>
          {tables.map((row) => (
            <button
              key={`${row.edgeType}-${row.node.id}`}
              type="button"
              onClick={() => focusEntity(row.node.id, { view: "data" })}
              className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-node-table/40 text-left transition-colors"
              title={`Open ${row.node.name} in the Data view`}
            >
              <span className="text-node-table shrink-0" aria-hidden>▤</span>
              {row.access && (
                <span className={`text-[8px] font-bold uppercase px-1 rounded shrink-0 ${row.access === "write" ? "text-[#c97070] bg-[#c97070]/15" : "text-node-function bg-node-function/15"}`}>
                  {row.access === "write" ? "W" : "R"}
                </span>
              )}
              <span className="text-text-primary truncate flex-1">{row.node.name}</span>
            </button>
          ))}
        </div>
      )}
      {envVars.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Config / env ({envVars.length})
          </div>
          {envVars.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => focusEntity(v.id, { view: "structural" })}
              className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-node-config-ops/40 text-left transition-colors"
              title={`Jump to ${v.name}`}
            >
              <span className="text-node-config-ops shrink-0" aria-hidden>⚙</span>
              <span className="font-mono text-text-primary truncate flex-1">{v.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 300-series items 99/103: Observability section. For a code node lists its
 * log_site (level + template), span_site, metric nodes emitted, plus alerts.
 * For an error_type node it shows raise sites + handlers (the stack-trace ends).
 */
function ObservabilitySection({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  if (!CODE_TYPES.has(node.type)) return null;

  const obs = observabilityFor(graph, node.id);
  const total = obs.logs.length + obs.spans.length + obs.metrics.length + obs.alerts.length;
  if (total === 0) return null;

  const row = (n: GraphNode, extra?: ReactNode) => (
    <button
      key={n.id}
      type="button"
      onClick={() => focusEntity(n.id, { view: "structural" })}
      className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-node-observability/40 text-left transition-colors"
      title={`Jump to ${n.name}`}
    >
      <span className="text-node-observability shrink-0" aria-hidden>{nodeTypeIcon(n.type)}</span>
      <span className="text-text-primary truncate flex-1">{n.name}</span>
      {extra}
    </button>
  );

  return (
    <div className="mb-4 space-y-2">
      <h3 className="text-[11px] font-semibold text-node-observability uppercase tracking-wider">
        Observability
      </h3>
      {obs.logs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Logs ({obs.logs.length})</div>
          {obs.logs.map((n) => {
            const { level, template } = logSiteDetail(n);
            return row(
              n,
              <span className="flex items-center gap-1.5 shrink-0 max-w-[55%]">
                {level && (
                  <span className="text-[8px] font-bold uppercase px-1 rounded bg-node-observability/15 text-node-observability shrink-0">
                    {level}
                  </span>
                )}
                {template && (
                  <span className="font-mono text-[10px] text-text-muted truncate" title={template}>{template}</span>
                )}
              </span>,
            );
          })}
        </div>
      )}
      {obs.spans.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Spans ({obs.spans.length})</div>
          {obs.spans.map((n) => row(n))}
        </div>
      )}
      {obs.metrics.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Metrics ({obs.metrics.length})</div>
          {obs.metrics.map((n) => row(n))}
        </div>
      )}
      {obs.alerts.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Alerts ({obs.alerts.length})</div>
          {obs.alerts.map((n) => row(
            n,
            n.severity ? (
              <span className="text-[8px] font-bold uppercase px-1 rounded bg-[#c97070]/15 text-[#c97070] shrink-0">{n.severity}</span>
            ) : undefined,
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 300-series items 92-95: Error-propagation section.
 *   • code node → "This function can fail with…" (transitive uncaught errors)
 *     + swallowed-error warnings + a "Show propagation" overlay toggle.
 *   • error_type node → raise sites + handlers, + a "Trace propagation" overlay.
 */
function ErrorPropagationSection({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const setErrorPropRoot = useDashboardStore((s) => s.setErrorPropRoot);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const errorPropRootId = useDashboardStore((s) => s.errorPropRootId);

  const isCode = CODE_TYPES.has(node.type);
  const isError = node.type === "error_type";
  if (!isCode && !isError) return null;

  const uncaught = isCode ? uncaughtErrorsFor(graph, node.id) : [];
  const swallowed = isCode ? swallowedErrorsFor(graph, node.id) : [];
  const raises = isError ? raiseSites(graph, node.id) : [];
  const handlers = isError ? handlerSites(graph, node.id) : [];

  const hasAnything =
    uncaught.length > 0 || swallowed.length > 0 || raises.length > 0 || handlers.length > 0;
  if (!hasAnything) return null;

  const active = errorPropRootId === node.id;
  const toggleOverlay = () => {
    setErrorPropRoot(active ? null : node.id);
    if (!active) setViewMode("structural");
  };

  const sevColor = (sev?: string) =>
    sev === "critical" || sev === "error" ? "#d35d6e" : sev === "warning" ? "#d4a574" : "#a78bda";

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-node-error uppercase tracking-wider">
          {isError ? "Propagation" : "Failure modes"}
        </h3>
        <button
          type="button"
          onClick={toggleOverlay}
          className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
            active
              ? "border-[#d35d6e]/60 bg-[#d35d6e]/15 text-[#d35d6e]"
              : "border-border-subtle text-text-muted hover:text-[#d35d6e] hover:border-[#d35d6e]/40"
          }`}
          title="Highlight the static stack-trace propagation set on the graph"
        >
          {active ? "✓ Tracing" : "Show propagation"}
        </button>
      </div>

      {/* Code node: "This function can fail with…" */}
      {isCode && uncaught.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            This function can fail with ({uncaught.length})
          </div>
          {uncaught.map((u) => (
            <button
              key={u.error.id}
              type="button"
              onClick={() => focusEntity(u.error.id, { view: "structural" })}
              className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-node-error/40 text-left transition-colors"
              title={u.raisedBy ? `Raised transitively via ${u.raisedBy.name}` : "Raised directly"}
            >
              <span className="shrink-0" style={{ color: sevColor(u.error.severity) }} aria-hidden>✕</span>
              <span className="text-text-primary truncate flex-1">{u.error.name}</span>
              {u.error.severity && (
                <span className="text-[8px] font-bold uppercase px-1 rounded shrink-0" style={{ color: sevColor(u.error.severity), backgroundColor: `${sevColor(u.error.severity)}22` }}>
                  {u.error.severity}
                </span>
              )}
              {u.raisedBy && (
                <span className="text-[9px] text-text-muted truncate max-w-[35%] shrink-0" title={u.raisedBy.name}>via {u.raisedBy.name}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Code node: swallowed-error warnings */}
      {isCode && swallowed.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-[#d4a574] flex items-center gap-1">
            <span aria-hidden>⚠</span> Swallows ({swallowed.length})
          </div>
          {swallowed.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => focusEntity(e.id, { view: "structural" })}
              className="w-full flex items-center gap-2 text-xs bg-[#d4a574]/10 rounded-lg px-3 py-1.5 border border-[#d4a574]/30 hover:border-[#d4a574]/60 text-left transition-colors"
              title="Empty / log-only / broad catch — the error is silently swallowed"
            >
              <span className="text-[#d4a574] shrink-0" aria-hidden>⚠</span>
              <span className="text-text-primary truncate flex-1">{e.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* error_type node: raise sites + handlers */}
      {isError && raises.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Raised by ({raises.length})</div>
          {raises.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => focusEntity(c.id, { view: "structural" })}
              className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-node-error/40 text-left transition-colors"
            >
              <span className="text-[#d35d6e] shrink-0" aria-hidden>↑</span>
              <span className="text-text-primary truncate flex-1">{c.name}</span>
            </button>
          ))}
        </div>
      )}
      {isError && handlers.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Handled by ({handlers.length})</div>
          {handlers.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => focusEntity(c.id, { view: "structural" })}
              className="w-full flex items-center gap-2 text-xs bg-elevated rounded-lg px-3 py-1.5 border border-border-subtle hover:border-node-function/40 text-left transition-colors"
            >
              <span className="text-[#5a9e6f] shrink-0" aria-hidden>✓</span>
              <span className="text-text-primary truncate flex-1">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NodeInfo() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const nodeHistory = useDashboardStore((s) => s.nodeHistory);
  const goBackNode = useDashboardStore((s) => s.goBackNode);
  const [languageExpanded, setLanguageExpanded] = useState(true);
  const { t } = useI18n();

  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const navigateToHistoryIndex = useDashboardStore((s) => s.navigateToHistoryIndex);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const setFocusNode = useDashboardStore((s) => s.setFocusNode);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const setTraceRoot = useDashboardStore((s) => s.setTraceRoot);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  // 200-series item 50: pin / freeze node position.
  const pinnedPositions = useDashboardStore((s) => s.pinnedPositions);
  const toggleNodePin = useDashboardStore((s) => s.toggleNodePin);
  const reactFlowInstance = useDashboardStore((s) => s.reactFlowInstance);

  const activeGraph = viewMode === "domain" && domainGraph ? domainGraph : graph;
  const node = activeGraph?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // Resolve history node names for the breadcrumb trail
  const historyNodes = nodeHistory.map((id) => {
    const n = activeGraph?.nodes.find((gn) => gn.id === id);
    return { id, name: n?.name ?? id };
  });

  if (!node) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-surface">
        <p className="text-text-muted text-sm">{t.common.selectNode}</p>
      </div>
    );
  }

  const allEdges = activeGraph?.edges ?? [];
  const connections = allEdges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );

  // Separate child nodes (contained IN this file) from other connections
  const childEdges = connections.filter(
    (e) => e.type === "contains" && e.source === node.id,
  );
  const otherConnections = connections.filter(
    (e) => !(e.type === "contains" && e.source === node.id),
  );

  // Resolve child nodes
  const childNodes = childEdges
    .map((e) => activeGraph?.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  // Item 77: group directional connections (Calls / Called-by, Imports /
  // Imported-by, …) so the relationship reads as a verb in the right
  // direction. Bucket key is the human directional label; each row jumps
  // via focusEntity so it lands consistently in the current view.
  const connectionGroups = (() => {
    const groups = new Map<string, { id: string; name: string; type: string }[]>();
    for (const edge of otherConnections) {
      const isSource = edge.source === node.id;
      const otherId = isSource ? edge.target : edge.source;
      const otherNode = activeGraph?.nodes.find((n) => n.id === otherId);
      const label = getDirectionalLabel(edge.type, isSource, t);
      let bucket = groups.get(label);
      if (!bucket) {
        bucket = [];
        groups.set(label, bucket);
      }
      bucket.push({ id: otherId, name: otherNode?.name ?? otherId, type: otherNode?.type ?? "file" });
    }
    return [...groups.entries()];
  })();

  const knownType = node.type as NodeType;
  const typeBadge = typeBadgeColors[knownType] ?? typeBadgeColors.file;
  const complexityBadge =
    complexityBadgeColors[node.complexity] ?? complexityBadgeColors.simple;

  if (import.meta.env.DEV && !(knownType in typeBadgeColors)) {
    console.warn(`[NodeInfo] Unknown node type "${node.type}" — using "file" badge colors`);
  }

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      {/* Navigation history trail */}
      {historyNodes.length > 0 && (
        <div className="mb-3 flex items-center gap-1 flex-wrap">
          <button
            onClick={goBackNode}
            className="text-[10px] font-semibold text-gold hover:text-gold-bright transition-colors flex items-center gap-1"
          >
            <span>←</span>
            <span>{t.common.back}</span>
          </button>
          <span className="text-text-muted text-[10px]">│</span>
          {historyNodes.slice(-3).map((h, i, arr) => (
            <span key={`${h.id}-${i}`} className="flex items-center gap-1">
              <button
                onClick={() => {
                  const fullIdx = historyNodes.length - arr.length + i;
                  navigateToHistoryIndex(fullIdx);
                }}
                className="text-[10px] text-text-muted hover:text-gold transition-colors truncate max-w-[80px]"
                title={h.name}
              >
                {h.name}
              </button>
              {i < arr.length - 1 && (
                <span className="text-text-muted text-[10px]">›</span>
              )}
            </span>
          ))}
          <span className="text-text-muted text-[10px]">›</span>
          <span className="text-[10px] text-text-primary font-medium truncate max-w-[80px]">
            {node.name}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${typeBadge}`}
        >
          {node.type}
        </span>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded ${complexityBadge}`}
        >
          {node.complexity}
        </span>
      </div>

      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="text-lg font-heading text-text-primary min-w-0 truncate">{node.name}</h2>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Item 50: pin / freeze this node's position across re-layouts */}
          <button
            onClick={() => {
              const rfNode = reactFlowInstance?.getNode(node.id);
              const pos = rfNode
                ? { x: rfNode.position.x, y: rfNode.position.y }
                : undefined;
              toggleNodePin(node.id, pos);
            }}
            className={`text-[12px] leading-none px-2 py-1 rounded transition-colors ${
              pinnedPositions[node.id]
                ? "bg-gold/20 text-gold border border-gold/40"
                : "text-text-muted border border-border-subtle hover:text-gold hover:border-gold/30"
            }`}
            title={
              pinnedPositions[node.id]
                ? "Unpin — let this node flow on the next re-layout"
                : "Pin — freeze this node's position across filters / re-layouts"
            }
            aria-pressed={!!pinnedPositions[node.id]}
          >
            {pinnedPositions[node.id] ? "📌" : "📍"}
          </button>
          <button
            onClick={() => setFocusNode(focusNodeId === node.id ? null : node.id)}
            className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
              focusNodeId === node.id
                ? "bg-gold/20 text-gold border border-gold/40"
                : "text-text-muted border border-border-subtle hover:text-gold hover:border-gold/30"
            }`}
          >
            {focusNodeId === node.id ? t.common.unfocus : t.common.focus}
          </button>
        </div>
      </div>

      <p className="text-sm text-text-secondary mb-4 leading-relaxed">
        {/* Item 167: dotted-underline glossary/domain terms for hover-to-define. */}
        <JargonText text={node.summary} />
      </p>

      {/* Operations-layer metadata (method · path · kind · severity) */}
      <OpsMetaBadges node={node} />

      {/* Flow / Trace entry point */}
      <button
        type="button"
        onClick={() => {
          setTraceRoot(node.id);
          setViewMode("trace");
        }}
        className="w-full mb-4 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent/40 bg-accent/10 text-accent text-sm font-semibold hover:bg-accent/20 hover:text-accent-bright hover:border-accent/60 transition-colors"
      >
        <span className="text-xs">▶</span>
        Trace flow from here
      </button>

      {node.filePath && (
        <div className="text-xs text-text-secondary mb-4 rounded-lg border border-border-subtle bg-elevated/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-text-muted mb-1">{t.common.file}</div>
              <div className="font-mono truncate" title={node.filePath}>
                {node.filePath}
                {node.lineRange && (
                  <span className="ml-2 text-text-muted">
                    L{node.lineRange[0]}-{node.lineRange[1]}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => openCodeViewer(node.id)}
              className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 transition-colors"
            >
              {t.common.openCode}
            </button>
          </div>
        </div>
      )}

      {node.languageNotes && (
        <div className="mb-4">
          <button
            onClick={() => setLanguageExpanded(!languageExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider mb-2 hover:text-accent-bright transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${languageExpanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {t.nodeInfo.languageConcepts}
          </button>
          {languageExpanded && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
              <p className="text-sm text-text-secondary leading-relaxed">
                {node.languageNotes}
              </p>
            </div>
          )}
        </div>
      )}

      {node.tags.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            {t.common.tags}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge-specific details */}
      {activeGraph && node && (node.type === "article" || node.type === "entity" || node.type === "topic" || node.type === "claim" || node.type === "source") && (
        <KnowledgeNodeDetails node={node} graph={activeGraph} />
      )}

      {/* Domain-specific details */}
      {activeGraph && node && (node.type === "domain" || node.type === "flow" || node.type === "step") && (
        <DomainNodeDetails node={node} graph={activeGraph} />
      )}

      {/* 300-series items 40-41 & 45: tests covering this node (or code under a
          test) + test-impact toggle. Renders nothing when there's no coverage. */}
      {activeGraph && node && <TestsSection node={node} graph={activeGraph} />}

      {/* 300-series items 71-73: data footprint (tables read/written + env vars). */}
      {activeGraph && node && <DataFootprintSection node={node} graph={activeGraph} />}

      {/* 300-series items 92-95: error-propagation — "can fail with…" / raise
          sites / handlers / swallowed warnings + propagation overlay toggle. */}
      {activeGraph && node && <ErrorPropagationSection node={node} graph={activeGraph} />}

      {/* 300-series items 99/103: observability — log/span/metric/alert nodes. */}
      {activeGraph && node && <ObservabilitySection node={node} graph={activeGraph} />}

      {/* Keystone: cross-layer operations connections (used_by / handles_route /
          queries_table / raises / tested_by / reads_config …). Renders nothing
          when the graph has no operations-layer enrichment yet. */}
      {activeGraph && node && <OpsLayerSection node={node} graph={activeGraph} />}

      {/* Child classes/functions within this file */}
      {childNodes.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-gold uppercase tracking-wider mb-2">
            {t.nodeInfo.definedInThisFile} ({childNodes.length})
          </h3>
          <div className="space-y-1">
            {childNodes.map((child) => {
              if (!child) return null;
              const childTypeBadge = typeBadgeColors[child.type as NodeType] ?? typeBadgeColors.file;
              const childComplexity = complexityBadgeColors[child.complexity] ?? complexityBadgeColors.simple;
              return (
                <div
                  key={child.id}
                  className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle cursor-pointer hover:border-gold/40 hover:bg-gold/5 transition-colors"
                  onClick={() => navigateToNode(child.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${childTypeBadge}`}>
                      {child.type}
                    </span>
                    <span className="text-text-primary truncate">{child.name}</span>
                    <span className={`text-[9px] ml-auto ${childComplexity} px-1 py-0.5 rounded`}>
                      {child.complexity}
                    </span>
                  </div>
                  {child.summary && (
                    <p className="text-[11px] text-text-muted mt-1 line-clamp-1 pl-1">
                      {child.summary}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other connections \u2014 grouped by directional relationship (item 77) */}
      {connectionGroups.length > 0 && (
        <div className="space-y-3">
          {connectionGroups.map(([label, rows]) => (
            <div key={label}>
              <h3 className="text-[11px] font-semibold text-gold uppercase tracking-wider mb-2">
                {label} ({rows.length})
              </h3>
              <div className="space-y-1.5">
                {rows.map((row, i) => {
                  const rowBadge = typeBadgeColors[row.type as NodeType] ?? typeBadgeColors.file;
                  return (
                    <div
                      key={`${row.id}-${i}`}
                      className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle flex items-center gap-2 cursor-pointer hover:border-gold/40 hover:bg-gold/5 transition-colors"
                      onClick={() => focusEntity(row.id)}
                      title={`Jump to ${row.name}`}
                    >
                      <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${rowBadge}`}>
                        {row.type}
                      </span>
                      <span className="text-text-primary truncate">{row.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

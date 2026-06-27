import { useDashboardStore } from "../store";

/**
 * Feature 94: domain breadcrumb. Reuses the `Breadcrumb` visual language:
 * `Domains › <domain> › <flow>`. Each crumb is clickable to pop back up a
 * level (Domains → overview, Domain → clear flow/selection within domain).
 */
export default function DomainBreadcrumb() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const focusedFlowId = useDashboardStore((s) => s.focusedFlowId);
  const clearActiveDomain = useDashboardStore((s) => s.clearActiveDomain);
  const setFocusedFlow = useDashboardStore((s) => s.setFocusedFlow);
  const selectNode = useDashboardStore((s) => s.selectNode);

  if (!domainGraph) return null;

  const domain = activeDomainId
    ? domainGraph.nodes.find((n) => n.id === activeDomainId)
    : null;

  // The "flow" crumb: focused flow takes priority, else a selected flow node.
  const flowId =
    focusedFlowId ??
    (selectedNodeId &&
    domainGraph.nodes.find((n) => n.id === selectedNodeId)?.type === "flow"
      ? selectedNodeId
      : null);
  const flow = flowId
    ? domainGraph.nodes.find((n) => n.id === flowId)
    : null;

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-4 py-2 rounded-full bg-elevated border border-border-subtle text-xs font-semibold shadow-lg max-w-[70%]">
      <button
        type="button"
        onClick={() => clearActiveDomain()}
        className={`tracking-wider uppercase transition-colors ${
          domain ? "text-gold hover:text-gold-bright" : "text-text-secondary"
        }`}
      >
        Domains
      </button>

      {domain && (
        <>
          <span className="text-text-muted">›</span>
          <button
            type="button"
            onClick={() => {
              // Pop to domain level: clear flow focus + selection.
              setFocusedFlow(null);
              selectNode(domain.id);
            }}
            className={`truncate transition-colors ${
              flow ? "text-gold hover:text-gold-bright" : "text-text-primary"
            }`}
            title={domain.name}
          >
            {domain.name}
          </button>
        </>
      )}

      {flow && (
        <>
          <span className="text-text-muted">›</span>
          <span className="text-text-primary truncate" title={flow.name}>
            {flow.name}
          </span>
        </>
      )}
    </div>
  );
}

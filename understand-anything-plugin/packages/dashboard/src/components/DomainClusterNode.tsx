import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";
import { flowsForDomain } from "../utils/domainHelpers";

export interface DomainClusterData extends Record<string, unknown> {
  label: string;
  summary: string;
  entities?: string[];
  flowCount: number;
  businessRules?: string[];
  domainId: string;
  /** Item 104: no inbound cross_domain edges → entry domain (▶). */
  isEntry?: boolean;
  /** Item 104: no outbound cross_domain edges → terminal domain (■). */
  isTerminal?: boolean;
  /** Item 103: storyline playback is currently highlighting this domain. */
  storyActive?: boolean;
  /** Item 103/114: dimmed (another domain is the active story hop / entity). */
  dimmed?: boolean;
}

export type DomainClusterFlowNode = Node<DomainClusterData, "domain-cluster">;

function DomainClusterNode({ data }: NodeProps<DomainClusterFlowNode>) {
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const openContextMenu = useDashboardStore((s) => s.openContextMenu);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const expandedDomainFlows = useDashboardStore((s) => s.expandedDomainFlows);
  const toggleDomainFlowsExpanded = useDashboardStore(
    (s) => s.toggleDomainFlowsExpanded,
  );
  const setFocusedFlow = useDashboardStore((s) => s.setFocusedFlow);
  const isSelected = selectedNodeId === data.domainId;
  const isExpanded = expandedDomainFlows.has(data.domainId);

  // Feature 91: accordion the domain's flows inline (no full-screen swap).
  const flows =
    isExpanded && domainGraph ? flowsForDomain(domainGraph, data.domainId) : [];

  return (
    <div
      className={`rounded-xl border-2 px-5 py-4 min-w-[280px] max-w-[360px] cursor-pointer transition-all ${
        data.storyActive
          ? "border-accent ring-2 ring-accent/50 bg-accent/10 shadow-lg shadow-accent/20"
          : isSelected
            ? "border-accent bg-accent/10 shadow-lg shadow-accent/10"
            : "border-accent/40 bg-surface hover:border-accent/70"
      } ${data.dimmed ? "opacity-30" : ""}`}
      onClick={() => selectNode(data.domainId)}
      onDoubleClick={() => navigateToDomain(data.domainId)}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu(data.domainId, e.clientX, e.clientY);
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      <div className="flex items-center gap-1.5 mb-1">
        {/* Item 104: entry / terminal domain badges. */}
        {data.isEntry && (
          <span
            title="Entry domain — no inbound cross-domain edges"
            className="text-[9px] font-semibold px-1 py-0.5 rounded bg-[#5bc9a0]/15 text-[#5bc9a0] shrink-0"
          >
            ▶ entry
          </span>
        )}
        {data.isTerminal && (
          <span
            title="Terminal domain — no outbound cross-domain edges"
            className="text-[9px] font-semibold px-1 py-0.5 rounded bg-[#c97070]/15 text-[#c97070] shrink-0"
          >
            ■ terminal
          </span>
        )}
        <div className="font-heading text-sm text-accent font-semibold truncate">
          {data.label}
        </div>
      </div>
      <div className="text-[11px] text-text-secondary line-clamp-2 mb-2">
        {data.summary}
      </div>

      {data.entities && data.entities.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] uppercase tracking-wider text-text-muted mb-1">Entities</div>
          <div className="flex flex-wrap gap-1">
            {data.entities.slice(0, 5).map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-text-secondary">
                {e}
              </span>
            ))}
            {data.entities.length > 5 && (
              <span className="text-[10px] text-text-muted">+{data.entities.length - 5}</span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleDomainFlowsExpanded(data.domainId);
          }}
          className="text-[10px] text-text-muted hover:text-accent transition-colors flex items-center gap-1"
        >
          <span className="inline-block w-2.5 text-center">
            {isExpanded ? "▾" : "▸"}
          </span>
          {data.flowCount} flow{data.flowCount !== 1 ? "s" : ""}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigateToDomain(data.domainId);
          }}
          className="text-[9px] text-text-muted hover:text-accent transition-colors"
        >
          open →
        </button>
      </div>

      {/* Feature 91: inline flow accordion */}
      {isExpanded && flows.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border-subtle space-y-1 max-h-[220px] overflow-auto">
          {flows.map(({ flow, steps }) => (
            <button
              key={flow.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigateToDomain(data.domainId);
                selectNode(flow.id);
                setFocusedFlow(flow.id);
              }}
              className="block w-full text-left px-2 py-1.5 rounded bg-elevated hover:bg-accent/10 transition-colors group"
            >
              <div className="text-[11px] font-medium text-text-primary group-hover:text-accent truncate">
                {flow.name}
              </div>
              <div className="text-[9px] text-text-muted">
                {steps.length} step{steps.length !== 1 ? "s" : ""}
                {flow.domainMeta?.entryPoint ? (
                  <span className="ml-1 font-mono text-accent/60 truncate">
                    {String(flow.domainMeta.entryPoint)}
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(DomainClusterNode);

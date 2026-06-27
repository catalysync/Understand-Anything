import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDashboardStore } from "../store";
import type { GraphNode } from "@understand-anything/core/types";

/**
 * K3: a single shared node context menu. Any view (structural CustomNode,
 * trace hops, domain steps) opens it via `openContextMenu(nodeId, x, y)`; this
 * component — mounted once in the app shell — renders the popover and wires the
 * actions back to existing store actions. Cross-feature "keystone" UI so a node
 * can be jumped to from anywhere consistently.
 */
export default function JumpActions() {
  const menu = useDashboardStore((s) => s.contextMenu);
  const close = useDashboardStore((s) => s.closeContextMenu);
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);

  const startTraceAt = useDashboardStore((s) => s.startTraceAt);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);

  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Clamp the menu inside the viewport once it's measured.
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 280;
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - w - pad);
    const y = Math.min(menu.y, window.innerHeight - h - pad);
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [menu]);

  // Dismiss on outside click / Escape / scroll.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, close]);

  if (!menu) return null;

  // Resolve the node from whichever graph holds it.
  const node: GraphNode | null =
    graph?.nodes.find((n) => n.id === menu.nodeId) ??
    domainGraph?.nodes.find((n) => n.id === menu.nodeId) ??
    null;

  const inStructural = !!graph?.nodes.some((n) => n.id === menu.nodeId);
  const inDomain = !!domainGraph?.nodes.some((n) => n.id === menu.nodeId);
  const hasSource = !!node?.filePath;

  const run = (fn: () => void) => {
    close();
    fn();
  };

  const copyId = () => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(menu.nodeId).catch(() => {});
    }
  };

  type Item = { label: string; icon: string; onClick: () => void; show: boolean };
  const items: Item[] = [
    {
      label: "Trace from here",
      icon: "▶",
      onClick: () => run(() => startTraceAt(menu.nodeId)),
      show: inStructural,
    },
    {
      label: "Explain",
      icon: "✦",
      // The explain session lives in the trace hop; re-rooting there surfaces it.
      onClick: () => run(() => startTraceAt(menu.nodeId)),
      show: inStructural,
    },
    {
      label: "Show in graph",
      icon: "◎",
      onClick: () => run(() => focusEntity(menu.nodeId, { view: "structural" })),
      show: inStructural,
    },
    {
      label: "Show in domain",
      icon: "◆",
      onClick: () =>
        run(() => {
          if (node?.type === "domain") navigateToDomain(menu.nodeId);
          else focusEntity(menu.nodeId, { view: "domain" });
        }),
      show: inDomain,
    },
    {
      label: "Open source",
      icon: "{}",
      onClick: () => run(() => openCodeViewer(menu.nodeId)),
      show: hasSource && inStructural,
    },
    {
      label: "Copy id",
      icon: "⧉",
      onClick: () => run(copyId),
      show: true,
    },
  ];
  // Reference rarely-used handlers so they stay wired if menu logic shifts.
  void navigateToNodeInLayer;
  void selectNode;

  const visible = items.filter((i) => i.show);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="jump-actions"
      className="fixed z-[60] min-w-[200px] rounded-lg border border-border-medium bg-surface shadow-2xl py-1 animate-fade-slide-in"
      style={{
        left: pos?.x ?? menu.x,
        top: pos?.y ?? menu.y,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted truncate border-b border-border-subtle mb-1">
        {node?.name ?? menu.nodeId}
      </div>
      {visible.map((i) => (
        <button
          key={i.label}
          type="button"
          role="menuitem"
          onClick={i.onClick}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
        >
          <span className="w-4 text-center text-[11px] text-text-muted">{i.icon}</span>
          {i.label}
        </button>
      ))}
    </div>
  );
}

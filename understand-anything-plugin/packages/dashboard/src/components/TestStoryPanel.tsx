import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import { testNodes, testStory, nodeTypeIcon } from "../utils/opsLayer";

/**
 * 300-series item 60: "Test Story" linear execution view. For a selected `test`
 * node, render a reading-order ribbon of the files/functions it covers/calls,
 * with file-transition dividers. Reuses the trace-tree linear-hop shape. Click a
 * hop to focus it; "▶" starts a trace there. Empty-states when the test has no
 * covers/calls edges, or when the graph has no test nodes.
 */
export default function TestStoryPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const focusEntity = useDashboardStore((s) => s.focusEntity);
  const startTraceAt = useDashboardStore((s) => s.startTraceAt);

  const tests = useMemo(() => testNodes(graph), [graph]);

  // Default to the selected node if it's a test, else the first test.
  const [picked, setPicked] = useState<string | null>(null);
  const activeId = useMemo(() => {
    if (picked && tests.some((t) => t.id === picked)) return picked;
    if (selectedNodeId && tests.some((t) => t.id === selectedNodeId)) return selectedNodeId;
    return tests[0]?.id ?? null;
  }, [picked, selectedNodeId, tests]);

  const story = useMemo(
    () => (activeId ? testStory(graph, activeId) : null),
    [graph, activeId],
  );

  if (tests.length === 0) {
    return (
      <div className="px-5 py-6 text-center">
        <div className="text-2xl mb-2">✓</div>
        <p className="text-sm text-text-primary font-medium mb-1">No tests yet</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Once the graph has <span className="font-mono">test</span> nodes with{" "}
          <span className="font-mono">covers</span> / <span className="font-mono">calls</span>{" "}
          edges, pick one here to see its linear execution story across files.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <h3 className="text-[11px] font-semibold text-node-test uppercase tracking-wider">
        Test story ({tests.length} test{tests.length === 1 ? "" : "s"})
      </h3>

      {/* Test picker */}
      <select
        value={activeId ?? ""}
        onChange={(e) => setPicked(e.target.value)}
        className="w-full bg-surface text-text-primary text-xs rounded-md px-2.5 py-2 border border-border-subtle focus:outline-none focus:border-accent/50"
      >
        {tests.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {!story || story.hops.length === 0 ? (
        <div className="px-2 py-6 text-center">
          <p className="text-xs text-text-muted leading-relaxed">
            This test has no <span className="font-mono">covers</span> /{" "}
            <span className="font-mono">calls</span> edges yet — nothing to linearize.
          </p>
        </div>
      ) : (
        <>
          <div className="text-[10px] text-text-muted px-1">
            {story.hops.length} step{story.hops.length === 1 ? "" : "s"} ·{" "}
            {story.files.length} file{story.files.length === 1 ? "" : "s"}
          </div>

          {/* Linear ribbon: file dividers + indented hop rows. */}
          <div className="relative pl-3">
            {/* vertical rail */}
            <div className="absolute left-1 top-1 bottom-1 w-px bg-border-subtle" aria-hidden />
            <div className="space-y-0.5">
              {story.hops.map((h) => (
                <div key={`${h.node.id}-${h.step}`}>
                  {h.fileTransition && (
                    <div className="flex items-center gap-1.5 mt-2 mb-1 -ml-3">
                      <span className="text-text-muted text-[10px]" aria-hidden>📄</span>
                      <span className="font-mono text-[10px] text-node-endpoint truncate">
                        {h.filePath ?? "(unknown file)"}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 group">
                    <span className="font-mono text-[9px] text-text-muted w-5 shrink-0 text-right">
                      {h.step}
                    </span>
                    <button
                      type="button"
                      onClick={() => focusEntity(h.node.id)}
                      className="flex-1 min-w-0 flex items-center gap-1.5 text-xs bg-elevated rounded-md px-2 py-1 border border-border-subtle text-left hover:border-accent/40 transition-colors"
                      title={h.node.summary || h.node.name}
                    >
                      <span className="shrink-0" aria-hidden>{nodeTypeIcon(h.node.type)}</span>
                      <span className="flex-1 min-w-0 truncate text-text-primary group-hover:text-accent transition-colors">
                        {h.node.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => startTraceAt(h.node.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/30 text-accent hover:text-accent-bright transition-all"
                      title="Trace from here"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

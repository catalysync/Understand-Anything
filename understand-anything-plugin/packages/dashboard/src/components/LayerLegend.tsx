import { useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import {
  resolveLayerColor,
  resolveLayerName,
  COLOR_SWATCHES,
} from "../utils/layerOverrides";

// Shared layer color palette — used by LayerLegend, LayerClusterNode, PortalNode, and GraphView
export const LAYER_PALETTE = [
  { bg: "rgba(74, 124, 155, 0.12)", border: "rgba(74, 124, 155, 0.4)", label: "#4a7c9b" },   // blue (API)
  { bg: "rgba(90, 158, 111, 0.12)", border: "rgba(90, 158, 111, 0.4)", label: "#5a9e6f" },   // green (Data)
  { bg: "rgba(139, 111, 176, 0.12)", border: "rgba(139, 111, 176, 0.4)", label: "#8b6fb0" }, // purple (Service)
  { bg: "rgba(201, 160, 108, 0.12)", border: "rgba(201, 160, 108, 0.4)", label: "#c9a06c" }, // gold (Config)
  { bg: "rgba(176, 122, 138, 0.12)", border: "rgba(176, 122, 138, 0.4)", label: "#b07a8a" }, // pink (UI)
  { bg: "rgba(74, 155, 140, 0.12)", border: "rgba(74, 155, 140, 0.4)", label: "#4a9b8c" },   // teal (Middleware)
  { bg: "rgba(120, 130, 145, 0.12)", border: "rgba(120, 130, 145, 0.4)", label: "#788291" }, // slate (Test)
];

export function getLayerColor(index: number) {
  return LAYER_PALETTE[index % LAYER_PALETTE.length];
}

export default function LayerLegend() {
  const graph = useDashboardStore((s) => s.graph);
  const navigationLevel = useDashboardStore((s) => s.navigationLevel);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const overrides = useDashboardStore((s) => s.layerOverrides);
  const setLayerOverride = useDashboardStore((s) => s.setLayerOverride);
  const resetLayerOverride = useDashboardStore((s) => s.resetLayerOverride);
  const { t } = useI18n();

  // 200-79: which layer's customization popover is open (by id).
  const [editing, setEditing] = useState<string | null>(null);

  const layers = graph?.layers ?? [];
  const hasLayers = layers.length > 0;

  if (!hasLayers) return null;

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const activeName = activeLayer
    ? resolveLayerName(overrides, activeLayer.id, activeLayer.name)
    : t.layer.defaultName;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-text-secondary whitespace-nowrap">
        {navigationLevel === "overview"
          ? `${layers.length} ${t.layer.label}`
          : activeName}
      </span>

      <div className="flex items-center gap-3">
        {layers.map((layer, i) => {
          const color = resolveLayerColor(overrides, layer.id, i);
          const name = resolveLayerName(overrides, layer.id, layer.name);
          const isActive = navigationLevel === "layer-detail" && layer.id === activeLayerId;
          const isEditing = editing === layer.id;
          return (
            <div key={layer.id} className="relative flex items-center gap-1 whitespace-nowrap">
              <button
                type="button"
                className="inline-block w-2 h-2 rounded-full cursor-pointer"
                title="Recolor / rename this layer"
                onClick={() => setEditing((e) => (e === layer.id ? null : layer.id))}
                style={{
                  backgroundColor: color.label,
                  opacity: navigationLevel === "layer-detail" && !isActive ? 0.3 : 1,
                }}
              />
              <span
                className={`text-[11px] cursor-pointer ${
                  isActive ? "text-text-primary font-medium" : "text-text-secondary"
                }`}
                onClick={() => setEditing((e) => (e === layer.id ? null : layer.id))}
                style={{
                  opacity: navigationLevel === "layer-detail" && !isActive ? 0.4 : 1,
                }}
              >
                {name}
                <span className="text-text-muted ml-0.5">
                  ({layer.nodeIds.length})
                </span>
              </span>

              {isEditing && (
                <div className="absolute top-5 left-0 z-30 rounded-lg border border-border-medium bg-surface shadow-2xl p-2.5 w-[200px]">
                  <div className="text-[10px] font-semibold text-text-secondary mb-1">Rename layer</div>
                  <input
                    type="text"
                    defaultValue={name}
                    placeholder={layer.name}
                    onBlur={(e) => setLayerOverride(layer.id, { name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setLayerOverride(layer.id, { name: (e.target as HTMLInputElement).value });
                        setEditing(null);
                      }
                    }}
                    className="w-full text-[11px] bg-elevated border border-border-medium rounded px-1.5 py-1 text-text-primary mb-2"
                  />
                  <div className="text-[10px] font-semibold text-text-secondary mb-1">Color</div>
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {COLOR_SWATCHES.map((sw) => (
                      <button
                        key={sw}
                        type="button"
                        onClick={() => setLayerOverride(layer.id, { color: sw })}
                        className="w-5 h-5 rounded-full border border-border-subtle"
                        style={{
                          backgroundColor: sw,
                          outline: overrides[layer.id]?.color === sw ? "2px solid var(--color-accent)" : "none",
                          outlineOffset: 1,
                        }}
                        aria-label={`Set color ${sw}`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => { resetLayerOverride(layer.id); setEditing(null); }}
                      className="text-[10px] text-text-muted hover:text-text-primary"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-[10px] px-2 py-0.5 rounded bg-accent/15 text-accent"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

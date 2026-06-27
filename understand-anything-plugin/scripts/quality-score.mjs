#!/usr/bin/env node
/**
 * quality-score.mjs — graph health score (catalog items 42 + 44).
 *
 * Computes a 0–100 health score for a knowledge-graph.json from four
 * sub-metrics, and (when a scan-result.json is available, or one can be
 * produced cheaply) a scanned-vs-graphed coverage note so users don't assume
 * 100% file coverage.
 *
 * Sub-scores (each 0–100, then weighted):
 *   coverage   (35%)  graphed source files / scanned source files
 *   orphans    (25%)  1 − (degree-0 nodes / total nodes)
 *   density    (20%)  edges per node mapped onto a healthy band [~1.2 .. ~6]
 *   tagging    (20%)  tagged nodes / total nodes
 *
 * Usage:
 *   node quality-score.mjs <project-root> [--json]
 *   node quality-score.mjs --graph <path/to/knowledge-graph.json> [--scan <scan-result.json>] [--json]
 *
 * Writes nothing. Pure read + report.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function fail(msg) {
  process.stderr.write(`quality-score: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

let graphPath = flag('--graph');
let scanPath = flag('--scan');
const positional = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--graph' && args[i - 1] !== '--scan');

if (!graphPath && positional) {
  const root = resolve(positional);
  graphPath = join(root, '.understand-anything', 'knowledge-graph.json');
  const candScan = join(root, '.understand-anything', 'intermediate', 'scan-result.json');
  if (!scanPath && existsSync(candScan)) scanPath = candScan;
}
if (!graphPath) fail('Usage: node quality-score.mjs <project-root> [--json]  (or --graph <path>)');
graphPath = resolve(graphPath);
if (!existsSync(graphPath)) fail(`knowledge graph not found: ${graphPath}`);

let graph;
try {
  graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
} catch (e) {
  fail(`could not parse graph: ${e.message}`);
}

const nodes = graph.nodes || [];
const edges = graph.edges || [];
const totalNodes = nodes.length;
const totalEdges = edges.length;

if (totalNodes === 0) fail('graph has no nodes');

// --- Orphans (degree 0) -----------------------------------------------------
const degree = new Map();
for (const n of nodes) degree.set(n.id, 0);
for (const e of edges) {
  if (degree.has(e.source)) degree.set(e.source, degree.get(e.source) + 1);
  if (degree.has(e.target)) degree.set(e.target, degree.get(e.target) + 1);
}
let orphans = 0;
for (const v of degree.values()) if (v === 0) orphans++;
const orphanRatio = orphans / totalNodes;

// --- Tagging ----------------------------------------------------------------
let untagged = 0;
for (const n of nodes) if (!n.tags || n.tags.length === 0) untagged++;
const untaggedRatio = untagged / totalNodes;

// --- Density ----------------------------------------------------------------
const edgesPerNode = totalEdges / totalNodes;

// --- Coverage (scanned vs graphed source files) -----------------------------
const graphedFilePaths = new Set(
  nodes.filter((n) => n.type === 'file' && n.filePath).map((n) => n.filePath),
);
let coverage = null; // null when no scan available
let scannedSourceFiles = null;
let ungraphedSample = [];
if (scanPath && existsSync(scanPath)) {
  try {
    const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
    const sourceFiles = (scan.files || []).filter((f) => f.fileCategory === 'code');
    scannedSourceFiles = sourceFiles.length;
    if (scannedSourceFiles > 0) {
      const graphedCount = sourceFiles.filter((f) => graphedFilePaths.has(f.path)).length;
      coverage = graphedCount / scannedSourceFiles;
      ungraphedSample = sourceFiles
        .filter((f) => !graphedFilePaths.has(f.path))
        .slice(0, 15)
        .map((f) => f.path);
    }
  } catch {
    /* leave coverage null */
  }
}

// --- Sub-scores (0..100) ----------------------------------------------------
const clamp = (x) => Math.max(0, Math.min(100, x));
// Density band: <1.2 edges/node is sparse, >6 is hairball. Peak at ~3.
function densityScore(d) {
  if (d <= 0) return 0;
  if (d < 1.2) return clamp((d / 1.2) * 80); // ramp up to 80 at lower edge
  if (d <= 6) return 100;
  // gently penalize hairballs
  return clamp(100 - (d - 6) * 8);
}
const coverageScore = coverage == null ? null : clamp(coverage * 100);
const orphanScore = clamp((1 - orphanRatio) * 100);
const densScore = densityScore(edgesPerNode);
const taggingScore = clamp((1 - untaggedRatio) * 100);

// Re-weight when coverage is unavailable (skip its 35% slice, renormalize).
let weights = { coverage: 0.35, orphans: 0.25, density: 0.2, tagging: 0.2 };
const parts = [];
if (coverageScore != null) parts.push(['coverage', coverageScore, weights.coverage]);
parts.push(['orphans', orphanScore, weights.orphans]);
parts.push(['density', densScore, weights.density]);
parts.push(['tagging', taggingScore, weights.tagging]);
const wsum = parts.reduce((s, [, , w]) => s + w, 0);
const score = Math.round(parts.reduce((s, [, v, w]) => s + v * (w / wsum), 0));

function grade(s) {
  if (s >= 90) return 'A (excellent)';
  if (s >= 80) return 'B (healthy)';
  if (s >= 70) return 'C (acceptable)';
  if (s >= 60) return 'D (needs work)';
  return 'F (poor)';
}

const report = {
  graph: graphPath,
  score,
  grade: grade(score),
  totals: { nodes: totalNodes, edges: totalEdges, fileNodes: graphedFilePaths.size },
  metrics: {
    coverage: coverage == null ? null : { value: +(coverage * 100).toFixed(1), score: Math.round(coverageScore), scannedSourceFiles, graphedSourceFiles: graphedFilePaths.size },
    orphans: { count: orphans, ratioPct: +(orphanRatio * 100).toFixed(1), score: Math.round(orphanScore) },
    density: { edgesPerNode: +edgesPerNode.toFixed(2), score: Math.round(densScore) },
    tagging: { untagged, untaggedPct: +(untaggedRatio * 100).toFixed(1), score: Math.round(taggingScore) },
  },
  ungraphedSample,
};

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

const cov = report.metrics.coverage;
process.stdout.write(`
Graph health score: ${score}/100  —  ${report.grade}

  Nodes: ${totalNodes}   Edges: ${totalEdges}   File nodes: ${graphedFilePaths.size}

  Coverage   ${cov ? `${cov.value}%`.padEnd(8) : 'n/a'.padEnd(8)} (score ${cov ? cov.score : '—'})  ${cov ? `${cov.graphedSourceFiles}/${cov.scannedSourceFiles} scanned source files graphed` : 'no scan-result.json — coverage skipped, weights renormalized'}
  Orphans    ${`${report.metrics.orphans.ratioPct}%`.padEnd(8)} (score ${report.metrics.orphans.score})  ${orphans} degree-0 nodes
  Density    ${`${report.metrics.density.edgesPerNode}`.padEnd(8)} (score ${report.metrics.density.score})  edges per node
  Tagging    ${`${report.metrics.tagging.untaggedPct}%`.padEnd(8)} (score ${report.metrics.tagging.score})  ${untagged} untagged nodes
`);

if (ungraphedSample.length) {
  process.stdout.write(`\n  Scanned but not graphed (first ${ungraphedSample.length}):\n`);
  for (const p of ungraphedSample) process.stdout.write(`    ${p}\n`);
}

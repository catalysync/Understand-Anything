#!/usr/bin/env node
/**
 * dry-run.mjs — scope preview for /understand (catalog item 1).
 *
 * Runs SCAN + BATCH only, dispatches NO LLM work, and prints what *would* be
 * analyzed: file count, batch count, language breakdown, file-category
 * breakdown, and (optionally) the full file list. Nothing is written into the
 * target project's `.understand-anything/` directory — all intermediates go to
 * a throwaway temp dir that is removed on exit.
 *
 * Usage:
 *   node dry-run.mjs <project-root> [--files] [--json]
 *
 *   --files   also print every file that would be analyzed
 *   --json    emit a machine-readable JSON summary on stdout (implies no
 *             human-readable tables)
 *
 * Reuses the bundled deterministic scanner (skills/understand/scan-project.mjs)
 * and the Louvain batcher (skills/understand/compute-batches.mjs) so the
 * preview matches a real run's Phase 1 / Phase 1.5 exactly.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(__filename);
const SKILL_DIR = resolve(SCRIPTS_DIR, '..', 'skills', 'understand');
const SCAN = join(SKILL_DIR, 'scan-project.mjs');
const BATCH = join(SKILL_DIR, 'compute-batches.mjs');

function fail(msg) {
  process.stderr.write(`dry-run: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const projectRoot = args.find((a) => !a.startsWith('--'));
const showFiles = args.includes('--files');
const asJson = args.includes('--json');

if (!projectRoot) {
  fail('Usage: node dry-run.mjs <project-root> [--files] [--json]');
}
const root = resolve(projectRoot);

// All intermediates go to a temp dir so we never touch the project's graph.
const work = mkdtempSync(join(tmpdir(), 'ua-dry-run-'));
const interDir = join(work, '.understand-anything', 'intermediate');
mkdirSync(interDir, { recursive: true });
const scanOut = join(interDir, 'scan-result.json');

process.on('exit', () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
});

// --- Phase 1: SCAN ----------------------------------------------------------
// scan-project.mjs reads .understandignore from <projectRoot>, so we point it
// at the real root but redirect its output into the temp dir.
const scan = spawnSync('node', [SCAN, root, scanOut], { encoding: 'utf-8' });
if (scan.status !== 0) {
  process.stderr.write(scan.stderr || '');
  fail('scan-project.mjs failed');
}

let scanResult;
try {
  scanResult = JSON.parse(readFileSync(scanOut, 'utf-8'));
} catch (e) {
  fail(`could not read scan output: ${e.message}`);
}

// --- Phase 1.5: BATCH -------------------------------------------------------
// compute-batches.mjs derives its own paths from <project-root>, so we pass it
// the temp work dir (which already holds the scan-result.json we just wrote).
const batch = spawnSync('node', [BATCH, work], { encoding: 'utf-8' });
if (batch.status !== 0) {
  process.stderr.write(batch.stderr || '');
  fail('compute-batches.mjs failed');
}

let batchResult;
try {
  batchResult = JSON.parse(readFileSync(join(interDir, 'batches.json'), 'utf-8'));
} catch (e) {
  fail(`could not read batches output: ${e.message}`);
}

const files = scanResult.files || [];
const byLanguage = scanResult.stats?.byLanguage || {};
const byCategory = scanResult.stats?.byCategory || {};
const totalBatches = batchResult.totalBatches ?? (batchResult.batches || []).length;
const batchSizes = (batchResult.batches || []).map((b) => (b.files || []).length);

const summary = {
  projectRoot: root,
  totalFiles: files.length,
  filteredByIgnore: scanResult.filteredByIgnore ?? null,
  estimatedComplexity: scanResult.estimatedComplexity ?? null,
  totalBatches,
  batchSizes,
  byLanguage,
  byCategory,
};

if (asJson) {
  if (showFiles) summary.files = files.map((f) => f.path);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exit(0);
}

function table(obj) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '  (none)';
  const w = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join('\n');
}

const maxB = batchSizes.length ? Math.max(...batchSizes) : 0;
const minB = batchSizes.length ? Math.min(...batchSizes) : 0;

process.stdout.write(`
/understand --dry-run  (scope preview — no LLM dispatch, nothing written)

  Project:          ${root}
  Files to analyze: ${files.length}
  Filtered by ignore: ${summary.filteredByIgnore ?? '?'}
  Estimated size:   ${summary.estimatedComplexity ?? '?'}
  Batches:          ${totalBatches}  (sizes: min=${minB}, max=${maxB})

Languages:
${table(byLanguage)}

File categories:
${table(byCategory)}
`);

if (showFiles) {
  process.stdout.write('\nFiles:\n');
  for (const f of files) process.stdout.write(`  ${f.path}\n`);
}

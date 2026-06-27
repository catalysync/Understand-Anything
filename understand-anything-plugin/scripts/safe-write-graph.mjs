#!/usr/bin/env node
/**
 * safe-write-graph.mjs — atomic + validate-before-overwrite graph writer
 * (catalog items 19 + 20).
 *
 * Replaces a raw `writeFileSync(knowledge-graph.json, ...)` in Phase 7 with a
 * crash-safe, keep-last-good write:
 *
 *   1. Validate the candidate graph (core's validateGraph). On FATAL failure,
 *      refuse to overwrite — the existing knowledge-graph.json is left intact
 *      and the candidate is preserved at knowledge-graph.json.rejected for
 *      inspection. Exit non-zero.
 *   2. Before overwriting, copy the current good graph to
 *      knowledge-graph.json.bak (keep-last-good).
 *   3. Write to a temp file in the same directory, fsync, then atomically
 *      rename over knowledge-graph.json (temp + mv → never a half-written
 *      file even on crash mid-write).
 *
 * Usage:
 *   node safe-write-graph.mjs <candidate.json> <dest knowledge-graph.json>
 *   cat graph.json | node safe-write-graph.mjs - <dest knowledge-graph.json>
 *
 * Output: a one-line summary on stdout; warnings/errors on stderr.
 */

import { createRequire } from 'node:module';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '..');

function fail(msg) {
  process.stderr.write(`safe-write-graph: ${msg}\n`);
  process.exit(1);
}

const [, , candidateArg, destArg] = process.argv;
if (!candidateArg || !destArg) {
  fail('Usage: node safe-write-graph.mjs <candidate.json|-> <dest knowledge-graph.json>');
}
const dest = resolve(destArg);

// --- Load candidate (file or stdin) -----------------------------------------
let rawText;
if (candidateArg === '-') {
  rawText = readFileSync(0, 'utf-8');
} else {
  const cand = resolve(candidateArg);
  if (!existsSync(cand)) fail(`candidate not found: ${cand}`);
  rawText = readFileSync(cand, 'utf-8');
}

let candidate;
try {
  candidate = JSON.parse(rawText);
} catch (e) {
  fail(`candidate is not valid JSON: ${e.message}`);
}

// --- Load core validateGraph ------------------------------------------------
let validateGraph;
try {
  const require = createRequire(resolve(PLUGIN_ROOT, 'package.json'));
  let core;
  try {
    core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
  } catch {
    core = await import(pathToFileURL(resolve(PLUGIN_ROOT, 'packages/core/dist/index.js')).href);
  }
  validateGraph = core.validateGraph;
} catch (e) {
  fail(`could not load core validateGraph: ${e.message}`);
}

const result = validateGraph(candidate);

if (!result.success && result.fatal) {
  // Keep-last-good: do NOT overwrite. Preserve the rejected candidate.
  const rejectedPath = `${dest}.rejected`;
  try {
    writeFileSync(rejectedPath, JSON.stringify(candidate, null, 2), 'utf-8');
  } catch { /* best effort */ }
  process.stderr.write(
    `safe-write-graph: candidate REJECTED (fatal: ${result.fatal}). ` +
      `Existing graph left untouched. Rejected candidate saved to ${rejectedPath}\n`,
  );
  process.exit(2);
}

const issueCount = (result.issues || []).length;

// --- Keep-last-good backup --------------------------------------------------
let backedUp = false;
if (existsSync(dest)) {
  try {
    copyFileSync(dest, `${dest}.bak`);
    backedUp = true;
  } catch (e) {
    process.stderr.write(`safe-write-graph: warning — could not back up existing graph: ${e.message}\n`);
  }
}

// --- Atomic write: temp + fsync + rename ------------------------------------
// We write the *validated/auto-fixed* graph (result.data) so what lands on disk
// is exactly what passed validation.
const toWrite = result.data ?? candidate;
const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
try {
  const fd = openSync(tmp, 'w');
  writeSync(fd, JSON.stringify(toWrite, null, 2) + '\n');
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, dest); // atomic on same filesystem
} catch (e) {
  fail(`atomic write failed: ${e.message}`);
}

process.stdout.write(
  `safe-write-graph: wrote ${dest} ` +
    `(${(toWrite.nodes || []).length} nodes, ${(toWrite.edges || []).length} edges; ` +
    `${issueCount} non-fatal issue(s)${backedUp ? '; prior saved to .bak' : ''})\n`,
);

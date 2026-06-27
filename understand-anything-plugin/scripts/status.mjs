#!/usr/bin/env node
/**
 * status.mjs — freshness status for an analyzed project (catalog item 31).
 *
 * Prints last-analyzed time + commit, the count of files changed since then
 * (`git diff --name-only <hash>..HEAD`), and a recommended action. Runs no
 * analysis and writes nothing.
 *
 * Usage:
 *   node status.mjs <project-root> [--json]
 *
 * Recommended action heuristic:
 *   - no meta.json / no graph        → full      ("never analyzed")
 *   - 0 changed files                → skip      ("up to date")
 *   - changed <= 25% of analyzed     → incremental
 *   - otherwise                      → full
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function fail(msg) {
  process.stderr.write(`status: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const projectRoot = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
if (!projectRoot) fail('Usage: node status.mjs <project-root> [--json]');

const root = resolve(projectRoot);
const uaDir = join(root, '.understand-anything');
const metaPath = join(uaDir, 'meta.json');
const graphPath = join(uaDir, 'knowledge-graph.json');

const result = {
  projectRoot: root,
  analyzed: false,
  lastAnalyzedAt: null,
  gitCommitHash: null,
  analyzedFiles: null,
  changedFiles: null,
  changedFileList: [],
  recommendedAction: 'full',
  reason: 'never analyzed (no meta.json)',
};

if (existsSync(metaPath) && existsSync(graphPath)) {
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch (e) {
    fail(`could not read meta.json: ${e.message}`);
  }
  result.analyzed = true;
  result.lastAnalyzedAt = meta.lastAnalyzedAt ?? null;
  result.gitCommitHash = meta.gitCommitHash ?? null;
  result.analyzedFiles = meta.analyzedFiles ?? null;

  if (result.gitCommitHash) {
    const diff = spawnSync(
      'git',
      ['-C', root, 'diff', '--name-only', `${result.gitCommitHash}..HEAD`],
      { encoding: 'utf-8' },
    );
    if (diff.status !== 0) {
      // Most likely a detached commit, shallow clone, or non-repo.
      result.recommendedAction = 'full';
      result.reason = `git diff failed (commit unreachable?): ${(diff.stderr || '').trim()}`;
    } else {
      const changed = diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      result.changedFiles = changed.length;
      result.changedFileList = changed;
      if (changed.length === 0) {
        result.recommendedAction = 'skip';
        result.reason = 'up to date — no files changed since last analysis';
      } else if (
        result.analyzedFiles &&
        changed.length <= Math.max(1, Math.ceil(result.analyzedFiles * 0.25))
      ) {
        result.recommendedAction = 'incremental';
        result.reason = `${changed.length} file(s) changed (<=25% of ${result.analyzedFiles} analyzed)`;
      } else {
        result.recommendedAction = 'full';
        result.reason = `${changed.length} file(s) changed (large change set — full rebuild advised)`;
      }
    }
  } else {
    result.reason = 'meta.json has no gitCommitHash — cannot compute drift';
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

process.stdout.write(`
/understand --status  (${result.analyzed ? 'analyzed' : 'not analyzed'})

  Project:        ${root}
  Last analyzed:  ${result.lastAnalyzedAt ?? '—'}
  At commit:      ${result.gitCommitHash ? result.gitCommitHash.slice(0, 12) : '—'}
  Analyzed files: ${result.analyzedFiles ?? '—'}
  Changed since:  ${result.changedFiles ?? '—'}

  Recommended:    ${result.recommendedAction.toUpperCase()}
  Reason:         ${result.reason}
`);

if (result.changedFileList.length && result.changedFileList.length <= 40) {
  process.stdout.write('\n  Changed files:\n');
  for (const f of result.changedFileList) process.stdout.write(`    ${f}\n`);
}

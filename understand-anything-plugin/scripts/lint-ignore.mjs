#!/usr/bin/env node
/**
 * lint-ignore.mjs — lint .understandignore patterns (catalog item 7).
 *
 * Warns on user-authored ignore patterns that match ZERO files in the repo
 * (dead patterns — typos, renamed dirs, or copy-pasted boilerplate) and flags
 * the dangerous case of a pattern that would exclude the entire project.
 *
 * Only USER patterns are linted — the hardcoded DEFAULT_IGNORE_PATTERNS are
 * never warned about (they intentionally cover things that may be absent).
 *
 * Usage:
 *   node lint-ignore.mjs <project-root> [--json]
 *
 * Exit code is 0 even when warnings are present (this is advisory). It exits
 * non-zero only on hard errors (missing root, unreadable ignore file).
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '..');

function fail(msg) {
  process.stderr.write(`lint-ignore: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const projectRoot = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
if (!projectRoot) fail('Usage: node lint-ignore.mjs <project-root> [--json]');
const root = resolve(projectRoot);
if (!existsSync(root)) fail(`project root not found: ${root}`);

// Resolve the same `ignore` library the core IgnoreFilter uses, so our
// per-pattern matching is identical to a real run's filtering.
let ignoreFactory;
try {
  const coreRequire = createRequire(
    resolve(PLUGIN_ROOT, 'packages', 'core', 'package.json'),
  );
  ignoreFactory = (await import(pathToFileURL(coreRequire.resolve('ignore')).href)).default;
} catch (e) {
  fail(`could not load the 'ignore' library: ${e.message}`);
}

// --- Locate the user ignore files (Layers 2 & 3 from core's loader) ---------
const ignoreSources = [
  join(root, '.understand-anything', '.understandignore'),
  join(root, '.understandignore'),
].filter(existsSync);

if (ignoreSources.length === 0) {
  const msg = 'No .understandignore file found — nothing to lint.';
  if (asJson) process.stdout.write(JSON.stringify({ ok: true, message: msg, warnings: [] }, null, 2) + '\n');
  else process.stdout.write(`\nlint-ignore: ${msg}\n`);
  process.exit(0);
}

// Collect user patterns (ignore blank lines and comments), preserving source.
const patterns = [];
for (const src of ignoreSources) {
  const content = readFileSync(src, 'utf-8');
  content.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    patterns.push({ pattern: line, source: relative(root, src) || src, line: i + 1 });
  });
}

// --- Enumerate all repo files (git ls-files preferred, walk fallback) -------
function enumerate() {
  const git = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (git.status === 0 && git.stdout.trim()) {
    return git.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  // Fallback: recursive walk, skipping .git.
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

const allFiles = enumerate();
const totalFiles = allFiles.length;

// --- Per-pattern match counting ---------------------------------------------
// A negation (!foo) re-includes; counting "matches" for it is not meaningful
// in the dead-pattern sense, so we report it separately rather than as dead.
const warnings = [];
const results = [];

for (const p of patterns) {
  const isNegation = p.pattern.startsWith('!');
  // Build a single-pattern matcher. For negations, strip the ! and count what
  // the underlying glob would have caught (so a !x referencing nothing is also
  // surfaced as potentially dead).
  const probe = isNegation ? p.pattern.slice(1) : p.pattern;
  const ig = ignoreFactory();
  ig.add(probe);
  let count = 0;
  for (const f of allFiles) {
    if (ig.ignores(f)) count++;
  }
  const entry = { ...p, matches: count, negation: isNegation };
  results.push(entry);

  if (count === 0) {
    warnings.push({
      ...entry,
      kind: 'dead-pattern',
      message: `pattern '${p.pattern}' (${p.source}:${p.line}) matches 0 files`,
    });
  } else if (!isNegation && totalFiles > 0 && count === totalFiles) {
    warnings.push({
      ...entry,
      kind: 'excludes-everything',
      message: `pattern '${p.pattern}' (${p.source}:${p.line}) would exclude ALL ${totalFiles} files`,
    });
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify({ ok: true, totalFiles, patterns: results, warnings }, null, 2) + '\n');
  process.exit(0);
}

process.stdout.write(`
lint-ignore — ${ignoreSources.map((s) => relative(root, s)).join(', ')}  (${totalFiles} files in repo)

  Patterns checked: ${patterns.length}
  Warnings:         ${warnings.length}
`);

if (warnings.length) {
  process.stdout.write('\n');
  for (const w of warnings) process.stdout.write(`  [${w.kind}] ${w.message}\n`);
} else {
  process.stdout.write('\n  All patterns match at least one file. ✓\n');
}

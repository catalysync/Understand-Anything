/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execFile } from "child_process";

const CLAUDE_CLI = "/Users/mac/.local/bin/claude";
// In-memory cache for /explain.json keyed by `path:start:end`.
// Caches both the explanation text and the claude session id so follow-up
// questions can --resume the same grounded session.
const explainCache = new Map<string, { explanation: string; sessionId: string | null }>();

/**
 * Run `claude -p ... --output-format json` and return the result text plus
 * session_id. Optionally resume a prior session for grounded follow-ups.
 */
function runClaude(
  prompt: string,
  resumeSessionId?: string | null,
): Promise<{ ok: true; result: string; sessionId: string | null } | { ok: false; error: string }> {
  const args = ["-p", prompt, "--output-format", "json"];
  if (resumeSessionId) args.unshift("--resume", resumeSessionId);
  return new Promise((resolve) => {
    execFile(
      CLAUDE_CLI,
      args,
      { timeout: 90000, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: `claude -p failed: ${err.message}${stderr ? ` — ${stderr}` : ""}` });
          return;
        }
        const raw = (stdout ?? "").trim();
        try {
          const parsed = JSON.parse(raw) as { result?: string; session_id?: string };
          const result = (parsed.result ?? "").trim();
          if (!result) {
            resolve({ ok: false, error: "Empty result from claude -p" });
            return;
          }
          resolve({ ok: true, result, sessionId: parsed.session_id ?? null });
        } catch {
          // Fall back to treating stdout as plain text if JSON parse fails.
          if (raw) resolve({ ok: true, result: raw, sessionId: null });
          else resolve({ ok: false, error: "Empty/unparseable claude -p output" });
        }
      },
    );
  });
}

// Generate a one-time token when the server process starts.
// This token is printed to the terminal and must be in the URL
// to fetch knowledge-graph.json or diff-overlay.json.
const ACCESS_TOKEN = process.env.UNDERSTAND_ACCESS_TOKEN || crypto.randomBytes(16).toString("hex");
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

function graphFileCandidates(fileName: string): string[] {
  const graphDir = process.env.GRAPH_DIR;
  return [
    ...(graphDir
      ? [path.resolve(graphDir, `.understand-anything/${fileName}`)]
      : []),
    path.resolve(process.cwd(), `.understand-anything/${fileName}`),
    path.resolve(process.cwd(), `../../../.understand-anything/${fileName}`),
  ];
}

function findGraphFile(fileName: string): string | null {
  return graphFileCandidates(fileName).find((candidate) => fs.existsSync(candidate)) ?? null;
}

function projectRootFromGraphFile(candidate: string): string {
  return path.dirname(path.dirname(candidate));
}

function normalizeGraphPath(filePath: string, projectRoot: string): string | null {
  const rawPath = path.isAbsolute(filePath)
    ? filePath.startsWith(projectRoot)
      ? path.relative(projectRoot, filePath)
      : null
    : filePath;
  if (rawPath === null) return null;
  const normalized = path.normalize(rawPath);
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("\0") ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    path.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized.split(path.sep).join("/");
}

function graphFilePathSet(graphFile: string, projectRoot: string): Set<string> {
  const allowed = new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(graphFile, "utf-8")) as {
      nodes?: Array<Record<string, unknown>>;
    };
    for (const node of raw.nodes ?? []) {
      if (typeof node.filePath !== "string") continue;
      const normalized = normalizeGraphPath(node.filePath, projectRoot);
      if (normalized) allowed.add(normalized);
    }
  } catch {
    return allowed;
  }
  return allowed;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const byExt: Record<string, string> = {
    bash: "bash",
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    h: "c",
    hpp: "cpp",
    html: "markup",
    java: "java",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    txt: "text",
    yaml: "yaml",
    yml: "yaml",
  };
  return byExt[ext] ?? "text";
}

function sendJson(res: import("http").ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function rejectFileRequest(message: string, statusCode = 400) {
  return { statusCode, payload: { error: message } };
}

/**
 * Resolve a requested (relative) path to a safe absolute file path, applying
 * the same path-safety + knowledge-graph allowlist checks as readSourceFile.
 * Returns the absolute path + safe relative path on success, or an error
 * payload on failure.
 */
function resolveSafeFile(
  requestedPath: string,
):
  | { ok: true; absoluteFile: string; safeRelativePath: string }
  | { ok: false; statusCode: number; payload: { error: string } } {
  const fail = (message: string, statusCode = 400) =>
    ({ ok: false as const, ...rejectFileRequest(message, statusCode) });

  if (!requestedPath) return fail("Missing path");
  if (requestedPath.includes("\0")) return fail("Invalid path");
  if (path.isAbsolute(requestedPath)) return fail("Absolute paths are not allowed");

  const normalizedPath = path.normalize(requestedPath);
  if (
    normalizedPath === "." ||
    normalizedPath.startsWith(`..${path.sep}`) ||
    normalizedPath === ".." ||
    path.isAbsolute(normalizedPath)
  ) {
    return fail("Path must stay inside the project");
  }

  const graphFile = findGraphFile("knowledge-graph.json");
  if (!graphFile) {
    return fail("No knowledge graph found. Run /understand first.", 404);
  }

  const projectRoot = projectRootFromGraphFile(graphFile);
  const absoluteFile = path.resolve(projectRoot, normalizedPath);
  const relativeToRoot = path.relative(projectRoot, absoluteFile);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot === ".." ||
    path.isAbsolute(relativeToRoot)
  ) {
    return fail("Path must stay inside the project");
  }
  const safeRelativePath = relativeToRoot.split(path.sep).join("/");
  if (!graphFilePathSet(graphFile, projectRoot).has(safeRelativePath)) {
    return fail("File is not in the knowledge graph", 404);
  }
  return { ok: true, absoluteFile, safeRelativePath };
}

// ---------------------------------------------------------------------------
// Wave-4: mode-aware /explain.json. One endpoint serves explain | followup |
// quiz | walkthrough | subtree | ghost | confidence. Rules + context + level
// are prepended to the prompt; an affordance JSON tail is appended so the
// client can parse suggested questions / citations / confidence out of the text.
// ---------------------------------------------------------------------------

type ExplainMode =
  | "explain"
  | "followup"
  | "quiz"
  | "walkthrough"
  | "subtree"
  | "ghost"
  | "confidence";

const VALID_MODES = new Set<ExplainMode>([
  "explain",
  "followup",
  "quiz",
  "walkthrough",
  "subtree",
  "ghost",
  "confidence",
]);

/** Persona preamble keyed by the requested answer-detail level. */
function levelPreamble(level: unknown): string {
  if (level === "expert") {
    return "The reader is an EXPERIENCED engineer (but may be new to Go). Be precise and dense; skip basics, focus on design intent, edge cases, and idioms. ";
  }
  if (level === "intermediate") {
    return "The reader is a working developer who is NEW TO GO. Assume general programming fluency; teach the Go-specific concept(s) but don't over-explain basics. ";
  }
  return "The reader is NEW TO GO and to this codebase. Be beginner-friendly and concrete; teach the relevant Go concept(s) (goroutines, interfaces, error wrapping, context, defer, channels, struct embedding — only those present). ";
}

/** The fenced-JSON affordance tail every answer should append. */
const AFFORDANCE_TAIL =
  "\n\nAfter your human-readable answer, append EXACTLY ONE fenced ```json code block " +
  "(and nothing after it) shaped like:\n" +
  '```json\n{"suggested_questions":["short q1","short q2","short q3"],' +
  '"citations":[{"file":"relative/path.go","line":42}],' +
  '"confidence":0.0,"clarifying_question":""}\n```\n' +
  "Rules for that block: suggested_questions = 3 short natural follow-ups a reader would ask next. " +
  "citations = the file:line locations your answer leans on (use the file paths shown above). " +
  "confidence = your 0-1 confidence that you fully answered without guessing. " +
  "clarifying_question = a single question to ask the reader ONLY if confidence < 0.5, else an empty string.";

/** Prepend persisted rules + @-mention context + go-docs steer to a prompt. */
function decoratePrompt(
  base: string,
  opts: { rules?: unknown; context?: unknown; level?: unknown; goDocs?: unknown },
): string {
  const parts: string[] = [];
  parts.push(levelPreamble(opts.level));
  if (typeof opts.rules === "string" && opts.rules.trim()) {
    parts.push(
      "PROJECT GUIDANCE (always honor): " + opts.rules.trim().slice(0, 2000) + "\n",
    );
  }
  if (opts.goDocs) {
    parts.push(
      "Ground your answer in the Go standard library and language spec for any stdlib symbols involved; name the package/function precisely. ",
    );
  }
  let prompt = parts.join("") + "\n" + base;
  if (typeof opts.context === "string" && opts.context.trim()) {
    prompt +=
      "\n\nADDITIONAL CONTEXT the reader has pinned (reference it if relevant):\n" +
      opts.context.trim().slice(0, 12000);
  }
  return prompt;
}

/** Read a safe source snippet (with a little surrounding context). */
function readSnippet(
  safeRelativePath: string,
  absoluteFile: string,
  start: number,
  end: number,
): { snippet: string; lang: string } | null {
  try {
    const stat = fs.statSync(absoluteFile);
    if (!stat.isFile() || stat.size > MAX_SOURCE_FILE_BYTES) return null;
    const content = fs.readFileSync(absoluteFile, "utf8");
    const lines = content.split(/\r\n|\n|\r/);
    const ctxStart = Math.max(1, start - 6);
    const ctxEnd = Math.min(lines.length, end + 6);
    return {
      snippet: lines.slice(ctxStart - 1, ctxEnd).join("\n"),
      lang: detectLanguage(safeRelativePath),
    };
  } catch {
    return null;
  }
}

/**
 * Unified explain entrypoint. Dispatches on `mode`. For follow-ups (and quiz
 * grading / clarify replies / simpler-deeper) a sessionId + question resume the
 * grounded session. Ghost mode is a cheap one-liner and is cached.
 */
async function handleExplainRequest(
  body: Record<string, unknown>,
): Promise<{ statusCode: number; payload: unknown }> {
  const mode: ExplainMode = VALID_MODES.has(body.mode as ExplainMode)
    ? (body.mode as ExplainMode)
    : typeof body.sessionId === "string" && typeof body.question === "string"
    ? "followup"
    : "explain";

  const decor = {
    rules: body.rules,
    context: body.context,
    level: body.level,
    goDocs: body.goDocs,
  };

  // ----- Session-resuming modes (followup / quiz-grade / clarify reply) -----
  if (mode === "followup") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!sessionId) return { statusCode: 400, payload: { error: "Missing sessionId" } };
    if (!question) return { statusCode: 400, payload: { error: "Missing question" } };
    if (question.length > 4000) return { statusCode: 400, payload: { error: "Question too long" } };
    const base =
      "Continuing about the code/trace you have been discussing. Answer the reader's follow-up, " +
      "staying grounded in that exact code, using markdown (bold key terms, `inline code` for identifiers). Be concise.\n\n" +
      `Follow-up: ${question}`;
    const prompt = decoratePrompt(base, decor) + AFFORDANCE_TAIL;
    const out = await runClaude(prompt, sessionId);
    if (!out.ok) return { statusCode: 500, payload: { error: out.error } };
    return { statusCode: 200, payload: { result: out.result, session_id: out.sessionId } };
  }

  // ----- Quiz me (Socratic) — fresh or resumed -----
  if (mode === "quiz") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    // A grading turn carries the user's answer in `question`.
    if (sessionId && typeof body.question === "string") {
      const answer = body.question.trim().slice(0, 4000);
      const base =
        "The reader just answered your quiz question with:\n\n" +
        `"${answer}"\n\n` +
        "Grade it warmly: say what's right, gently correct what's off, and give the ideal answer. " +
        "Use markdown. Then optionally ask one harder follow-up question.";
      const prompt = decoratePrompt(base, decor) + AFFORDANCE_TAIL;
      const out = await runClaude(prompt, sessionId);
      if (!out.ok) return { statusCode: 500, payload: { error: out.error } };
      return { statusCode: 200, payload: { result: out.result, session_id: out.sessionId } };
    }
    // Otherwise: pose a fresh question about the supplied hop.
    const requestedPath = typeof body.path === "string" ? body.path : "";
    const resolved = resolveSafeFile(requestedPath);
    if (!resolved.ok) return { statusCode: resolved.statusCode, payload: resolved.payload };
    const start = Math.max(1, Math.floor(Number(body.start) || 1));
    const end = Math.max(start, Math.floor(Number(body.end) || start));
    const snip = readSnippet(resolved.safeRelativePath, resolved.absoluteFile, start, end);
    if (!snip) return { statusCode: 404, payload: { error: "File not found" } };
    const base =
      "Ask the reader ONE focused Socratic question about the Go / architecture of this code " +
      "to check their understanding (e.g. why an interface, what a goroutine guards, how an error propagates). " +
      "Pose only the question (1-2 sentences) — do NOT answer it; you'll grade their reply next.\n\n" +
      `File: ${resolved.safeRelativePath} lines ${start}-${end}\n` +
      "```" + snip.lang + "\n" + snip.snippet + "\n```";
    const prompt = decoratePrompt(base, decor) + AFFORDANCE_TAIL;
    const out = await runClaude(prompt);
    if (!out.ok) return { statusCode: 500, payload: { error: out.error } };
    return { statusCode: 200, payload: { explanation: out.result, session_id: out.sessionId } };
  }

  // ----- Subtree / walkthrough — reason over supplied `context`, no single file -----
  if (mode === "subtree" || mode === "walkthrough") {
    const context = typeof body.context === "string" ? body.context : "";
    if (!context.trim()) return { statusCode: 400, payload: { error: "Missing context" } };
    const base =
      mode === "subtree"
        ? "Reason across this whole sub-flow of the call tree. Explain what the sub-flow accomplishes end-to-end, " +
          "how the hops connect (who calls whom and why), and the key Go concept(s) at play. Use markdown."
        : "Walk the reader through this trace beginner-first, as an ordered narrative. For each step give a short " +
          "heading and 1-2 sentences of what happens and why, in call order. Use a numbered markdown list. " +
          "Keep it skimmable.";
    const prompt = decoratePrompt(base, decor) + AFFORDANCE_TAIL;
    const out = await runClaude(prompt);
    if (!out.ok) return { statusCode: 500, payload: { error: out.error } };
    return { statusCode: 200, payload: { explanation: out.result, session_id: out.sessionId } };
  }

  // ----- Ghost — cheap one-sentence explanation, cached -----
  if (mode === "ghost") {
    const requestedPath = typeof body.path === "string" ? body.path : "";
    const resolved = resolveSafeFile(requestedPath);
    if (!resolved.ok) return { statusCode: resolved.statusCode, payload: resolved.payload };
    const start = Math.max(1, Math.floor(Number(body.start) || 1));
    const end = Math.max(start, Math.floor(Number(body.end) || start));
    const cacheKey = `ghost:${resolved.safeRelativePath}:${start}:${end}`;
    const cached = explainCache.get(cacheKey);
    if (cached) {
      return { statusCode: 200, payload: { explanation: cached.explanation, session_id: null, cached: true } };
    }
    const snip = readSnippet(resolved.safeRelativePath, resolved.absoluteFile, start, end);
    if (!snip) return { statusCode: 404, payload: { error: "File not found" } };
    const prompt =
      "In ONE plain sentence (no markdown, no preamble), say what this code does. Be specific.\n\n" +
      "```" + snip.lang + "\n" + snip.snippet + "\n```";
    const out = await runClaude(prompt);
    if (!out.ok) return { statusCode: 500, payload: { error: out.error } };
    const oneLine = out.result.split(/\r?\n/).find((l) => l.trim())?.trim() ?? out.result.trim();
    explainCache.set(cacheKey, { explanation: oneLine, sessionId: null });
    return { statusCode: 200, payload: { explanation: oneLine, session_id: null } };
  }

  // ----- Default: line explanation (explain / confidence) -----
  const requestedPath = typeof body.path === "string" ? body.path : "";
  const start = Math.max(1, Math.floor(Number(body.start) || 1));
  const end = Math.max(start, Math.floor(Number(body.end) || start));
  const resolved = resolveSafeFile(requestedPath);
  if (!resolved.ok) return { statusCode: resolved.statusCode, payload: resolved.payload };

  // Cache only the plain explain mode without per-request decoration so the
  // affordance tail stays consistent; decorated requests skip the cache.
  const decorated = Boolean(
    (typeof body.rules === "string" && body.rules.trim()) ||
      (typeof body.context === "string" && body.context.trim()) ||
      body.goDocs ||
      (body.level && body.level !== "beginner"),
  );
  const cacheKey = `${resolved.safeRelativePath}:${start}:${end}`;
  if (!decorated) {
    const cached = explainCache.get(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        payload: { explanation: cached.explanation, session_id: cached.sessionId, cached: true },
      };
    }
  }

  const snip = readSnippet(resolved.safeRelativePath, resolved.absoluteFile, start, end);
  if (!snip) return { statusCode: 404, payload: { error: "File not found" } };

  const base =
    "Explain what these specific lines do, and briefly teach the relevant Go concept(s) they rely on. " +
    "4-7 sentences, concrete, reference the code. Use markdown (bold key terms, `inline code` for identifiers). " +
    "Remember this code so you can answer follow-up questions about it.\n\n" +
    `File: ${resolved.safeRelativePath} lines ${start}-${end}\n` +
    "```" + snip.lang + "\n" + snip.snippet + "\n```";
  const prompt = decoratePrompt(base, decor) + AFFORDANCE_TAIL;

  const out = await runClaude(prompt);
  if (!out.ok) return { statusCode: 500, payload: { error: out.error } };
  if (!decorated) explainCache.set(cacheKey, { explanation: out.result, sessionId: out.sessionId });
  return { statusCode: 200, payload: { explanation: out.result, session_id: out.sessionId } };
}

function readSourceFile(url: URL) {
  const requestedPath = url.searchParams.get("path") ?? "";
  if (!requestedPath) return rejectFileRequest("Missing path");
  if (requestedPath.includes("\0")) return rejectFileRequest("Invalid path");
  if (path.isAbsolute(requestedPath)) return rejectFileRequest("Absolute paths are not allowed");

  const normalizedPath = path.normalize(requestedPath);
  if (
    normalizedPath === "." ||
    normalizedPath.startsWith(`..${path.sep}`) ||
    normalizedPath === ".." ||
    path.isAbsolute(normalizedPath)
  ) {
    return rejectFileRequest("Path must stay inside the project");
  }

  const graphFile = findGraphFile("knowledge-graph.json");
  if (!graphFile) {
    return rejectFileRequest("No knowledge graph found. Run /understand first.", 404);
  }

  const projectRoot = projectRootFromGraphFile(graphFile);
  const absoluteFile = path.resolve(projectRoot, normalizedPath);
  const relativeToRoot = path.relative(projectRoot, absoluteFile);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot === ".." ||
    path.isAbsolute(relativeToRoot)
  ) {
    return rejectFileRequest("Path must stay inside the project");
  }
  const safeRelativePath = relativeToRoot.split(path.sep).join("/");
  if (!graphFilePathSet(graphFile, projectRoot).has(safeRelativePath)) {
    return rejectFileRequest("File is not in the knowledge graph", 404);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absoluteFile);
  } catch {
    return rejectFileRequest("File not found", 404);
  }

  if (!stat.isFile()) return rejectFileRequest("Path is not a file");
  if (stat.size > MAX_SOURCE_FILE_BYTES) {
    return rejectFileRequest("File is too large to preview", 413);
  }

  const buffer = fs.readFileSync(absoluteFile);
  if (buffer.includes(0)) return rejectFileRequest("Binary files cannot be previewed", 415);

  const content = buffer.toString("utf8");
  return {
    statusCode: 200,
    payload: {
      path: safeRelativePath,
      language: detectLanguage(relativeToRoot),
      content,
      sizeBytes: buffer.byteLength,
      lineCount: content.length === 0 ? 0 : content.split(/\r\n|\n|\r/).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Workspace persistence (bookmarks, annotations, node→session map, watches,
// saved tours). File-based at <projectRoot>/.understand-anything/workspace.json.
// ---------------------------------------------------------------------------

const EMPTY_WORKSPACE = {
  version: 1,
  bookmarks: [] as unknown[],
  annotations: [] as unknown[],
  sessions: {} as Record<string, string>,
  watches: [] as string[],
  tours: [] as unknown[],
  // Wave-4: persisted free-text trace rules + (reserved) snapshots. Wave 3
  // found unknown keys are silently dropped, so these must be whitelisted.
  rules: "",
  snapshots: [] as unknown[],
};

/** Resolve the workspace.json path next to the knowledge graph (or null). */
function workspaceFilePath(): string | null {
  const graphFile = findGraphFile("knowledge-graph.json");
  if (graphFile) return path.join(path.dirname(graphFile), "workspace.json");
  // Fall back to GRAPH_DIR / cwd so a fresh workspace can still be written.
  const graphDir = process.env.GRAPH_DIR;
  const base = graphDir
    ? path.resolve(graphDir, ".understand-anything")
    : path.resolve(process.cwd(), ".understand-anything");
  return path.join(base, "workspace.json");
}

function readWorkspace(): { statusCode: number; payload: unknown } {
  const file = workspaceFilePath();
  if (!file || !fs.existsSync(file)) {
    return { statusCode: 200, payload: EMPTY_WORKSPACE };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    return { statusCode: 200, payload: { ...EMPTY_WORKSPACE, ...raw } };
  } catch {
    return { statusCode: 200, payload: EMPTY_WORKSPACE };
  }
}

/** Stamp createdAt on any record missing it (server-side, Date available). */
function stampCreatedAt(records: unknown): unknown {
  if (!Array.isArray(records)) return records;
  const now = new Date().toISOString();
  return records.map((r) =>
    r && typeof r === "object" && !(r as Record<string, unknown>).createdAt
      ? { ...(r as Record<string, unknown>), createdAt: now }
      : r,
  );
}

function writeWorkspace(body: Record<string, unknown>): { statusCode: number; payload: unknown } {
  const file = workspaceFilePath();
  if (!file) return { statusCode: 500, payload: { error: "No workspace location" } };

  const next = {
    version: 1,
    bookmarks: stampCreatedAt(body.bookmarks ?? []),
    annotations: stampCreatedAt(body.annotations ?? []),
    sessions:
      body.sessions && typeof body.sessions === "object" ? body.sessions : {},
    watches: Array.isArray(body.watches) ? body.watches : [],
    tours: stampCreatedAt(body.tours ?? []),
    // Wave-4 whitelist: persist trace rules + snapshots.
    rules: typeof body.rules === "string" ? body.rules : "",
    snapshots: stampCreatedAt(body.snapshots ?? []),
  };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Atomic write: tmp file then rename.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
    fs.renameSync(tmp, file);
    return { statusCode: 200, payload: { ok: true, workspace: next } };
  } catch (err) {
    return {
      statusCode: 500,
      payload: { error: `Failed to write workspace: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },

  // FIX 1 — bind only to localhost, not 0.0.0.0
  // This blocks access from any other device on the same LAN / WiFi.
  server: {
    host: "127.0.0.1",
    port: 5173,
    open: `/?token=${ACCESS_TOKEN}`,
  },

  resolve: {
    alias: {
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/dist/schema.js"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/dist/search.js"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/dist/types.js"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@xyflow/")) return "xyflow";
          // ELK is ~1.6MB raw — split into its own chunk so it doesn't
          // bloat the main bundle. graphology is similarly large.
          if (id.includes("node_modules/elkjs/")) return "elk";
          if (id.includes("node_modules/graphology")) return "graphology";
          if (
            id.includes("node_modules/@dagrejs/") ||
            id.includes("node_modules/d3-force/")
          ) {
            return "graph-layout";
          }
          if (
            id.includes("node_modules/react-markdown/") ||
            id.includes("node_modules/hast-util-to-jsx-runtime/") ||
            /[\\/]node_modules[\\/](remark|rehype|mdast|hast|unist|micromark|decode-named-character-reference|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|devlop|bail|ccount|character-entities|is-plain-obj|trim-lines|trough|unified|vfile|zwitch)/.test(id)
          ) {
            return "markdown";
          }
        },
      },
    },
  },

  plugins: [
    react(),
    tailwindcss(),
    {
      name: "serve-knowledge-graph",
      configureServer(server) {
        // Print the access URL once so the developer can open it.
        server.httpServer?.once("listening", () => {
          const address = server.httpServer?.address();
          const port = typeof address === "object" && address ? address.port : 5173;
          console.log(
            `\n  🔑  Dashboard URL: http://127.0.0.1:${port}/?token=${ACCESS_TOKEN}\n`
          );
        });

        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1:5173");
          const pathname = url.pathname;
          const isProtectedEndpoint =
            pathname === "/knowledge-graph.json" ||
            pathname === "/domain-graph.json" ||
            pathname === "/diff-overlay.json" ||
            pathname === "/meta.json" ||
            pathname === "/config.json" ||
            pathname === "/file-content.json" ||
            pathname === "/explain.json" ||
            pathname === "/workspace.json";

          if (!isProtectedEndpoint) {
            next();
            return;
          }

          // /explain.json — accept POST (or GET) with { token, path, start, end }.
          // Reads the request body so the (potentially large) prompt context
          // and token travel in the body rather than the query string.
          if (pathname === "/explain.json") {
            const handleExplain = (body: Record<string, unknown>) => {
              const token =
                (typeof body.token === "string" ? body.token : null) ??
                url.searchParams.get("token");
              if (token !== ACCESS_TOKEN) {
                sendJson(res, 403, { error: "Forbidden: missing or invalid token" });
                return;
              }
              // Mode-aware dispatch (explain | followup | quiz | walkthrough |
              // subtree | ghost | confidence). Defaults inferred inside.
              handleExplainRequest(body)
                .then((result) => sendJson(res, result.statusCode, result.payload))
                .catch((e: unknown) =>
                  sendJson(res, 500, {
                    error: e instanceof Error ? e.message : String(e),
                  }),
                );
            };

            if (req.method === "GET") {
              handleExplain({
                token: url.searchParams.get("token"),
                path: url.searchParams.get("path"),
                start: url.searchParams.get("start"),
                end: url.searchParams.get("end"),
                mode: url.searchParams.get("mode"),
              });
              return;
            }

            let raw = "";
            req.on("data", (chunk) => {
              raw += chunk;
              // Wave-4: subtree/walkthrough/@-mention context can be large.
              if (raw.length > 256 * 1024) req.destroy();
            });
            req.on("end", () => {
              try {
                handleExplain(raw ? JSON.parse(raw) : {});
              } catch {
                sendJson(res, 400, { error: "Invalid JSON body" });
              }
            });
            return;
          }

          // FIX 3 — require the one-time token on all data endpoints.
          // Requests without a matching ?token= get a 403.
          if (url.searchParams.get("token") !== ACCESS_TOKEN) {
            sendJson(res, 403, { error: "Forbidden: missing or invalid token" });
            return;
          }

          if (pathname === "/file-content.json") {
            const result = readSourceFile(url);
            sendJson(res, result.statusCode, result.payload);
            return;
          }

          if (pathname === "/workspace.json") {
            if (req.method === "POST") {
              let raw = "";
              req.on("data", (chunk) => {
                raw += chunk;
                if (raw.length > 1 << 20) req.destroy();
              });
              req.on("end", () => {
                try {
                  const body = raw ? JSON.parse(raw) : {};
                  const result = writeWorkspace(body);
                  sendJson(res, result.statusCode, result.payload);
                } catch {
                  sendJson(res, 400, { error: "Invalid JSON body" });
                }
              });
              return;
            }
            const result = readWorkspace();
            sendJson(res, result.statusCode, result.payload);
            return;
          }

          if (pathname === "/config.json") {
            const configCandidates = graphFileCandidates("config.json");
            for (const candidate of configCandidates) {
              if (fs.existsSync(candidate)) {
                try {
                  const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
                  sendJson(res, 200, raw);
                  return;
                } catch {
                  sendJson(res, 500, { error: "Failed to read config file" });
                  return;
                }
              }
            }
            sendJson(res, 200, { autoUpdate: false, outputLanguage: "en" });
            return;
          }

          const fileName =
            pathname === "/diff-overlay.json"
              ? "diff-overlay.json"
              : pathname === "/meta.json"
              ? "meta.json"
              : pathname === "/domain-graph.json"
              ? "domain-graph.json"
              : "knowledge-graph.json";

          const candidates = graphFileCandidates(fileName);

          for (const candidate of candidates) {
            if (!fs.existsSync(candidate)) continue;

            // FIX 2 — sanitise absolute file paths before sending the JSON.
            // Nodes can contain filePath values like /Users/alice/company/src/auth.ts.
            // We convert those to relative paths (src/auth.ts) so the developer's
            // home directory and company directory layout are not leaked.
            try {
              const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as {
                nodes?: Array<Record<string, unknown>>;
                [key: string]: unknown;
              };

              // Derive the project root from the candidate path so we can
              // make file paths relative to it.
              const projectRoot = projectRootFromGraphFile(candidate);

              if (Array.isArray(raw.nodes)) {
                raw.nodes = raw.nodes.map((node) => {
                  if (typeof node.filePath !== "string") return node;
                  const abs = node.filePath;
                  // Only relativise paths that actually sit inside projectRoot.
                  // Leave external or already-relative paths untouched.
                  const rel = abs.startsWith(projectRoot)
                    ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
                    : path.isAbsolute(abs)
                    ? path.basename(abs) // absolute but outside root — use filename only
                    : abs;              // already relative — keep as-is
                  return { ...node, filePath: rel };
                });
              }

              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(raw));
            } catch (err) {
              // If we cannot parse or sanitise the file, refuse to serve it
              // rather than accidentally leaking raw content.
              console.error("[understand-anything] Failed to sanitise graph file:", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to read graph file" }));
            }
            return;
          }

          // No matching file found on disk.
          res.statusCode = 404;
          if (pathname === "/knowledge-graph.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "No knowledge graph found. Run /understand first." }));
          } else {
            res.end();
          }
        });
      },
    },
  ],
});

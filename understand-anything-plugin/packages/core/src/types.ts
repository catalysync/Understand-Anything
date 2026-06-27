// Node types — code + non-code + domain + knowledge + operations-layer (300-series).
// The operations-layer types describe entrypoints, tests, data, errors and
// observability so the 300-series features work for ANY language/framework.
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step"
  | "article" | "entity" | "topic" | "claim" | "source"
  // Operations layer — entrypoints / API surface
  // (`topic` for message buses reuses the existing knowledge `topic` type above)
  | "route" | "command" | "event" | "schedule" | "api"
  // Operations layer — tests & findings
  | "test" | "suite" | "fixture" | "finding"
  // Operations layer — data / DB
  | "column" | "model" | "query" | "transaction" | "migration"
  // Operations layer — config / flags / secrets / cache
  | "env_var" | "feature_flag" | "secret" | "cache_key"
  // Operations layer — errors
  | "error_type"
  // Operations layer — observability
  | "log_site" | "span_site" | "metric" | "alert"
  // Operations layer — ownership / docs / services / payloads
  | "owner" | "doc" | "payload_schema";

// NOTE on "topic": the catalog lists a `topic` node-type for event/message
// buses, but `topic` is already a KNOWLEDGE node-type above, so the operations
// layer reuses it (additive — no duplicate union member needed). The analyzer
// emits `event`/`topic` nodes for bus destinations.

// Edge types — structural + behavioral + data + domain + knowledge +
// operations-layer (300-series). The operations-layer edges bridge code nodes
// to the entrypoint / test / data / error / observability nodes above; the
// `used_by` keystone links every operations-layer node back to its code node.
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "provisions" | "triggers"                // Infrastructure
  | "migrates" | "documents" | "routes" | "defines_schema"          // Schema/Data
  | "contains_flow" | "flow_step" | "cross_domain"                  // Domain
  | "cites" | "contradicts" | "builds_on" | "exemplifies" | "categorized_under" | "authored_by" // Knowledge
  // Operations layer — entrypoints / API surface
  | "handles_route" | "exposes_api" | "provides_api" | "consumes_api"
  | "emits_event" | "consumes_event" | "triggered_by" | "subcommand_of"
  | "reachable_from" | "passes_through" | "short_circuits"
  // Operations layer — tests & findings
  | "covers" | "asserts_on" | "uses_fixture" | "temporal_coupling"
  | "duplicates" | "flags_vuln" | "killed_by"
  // Operations layer — data / DB
  | "foreign_key" | "inferred_fk" | "maps_to_table" | "has_column"
  | "has_association" | "queries_table" | "reads_table" | "writes_table"
  | "used_by" | "runs_in_loop" | "opens_transaction" | "derives_from"
  // Operations layer — config / flags / secrets / cache
  | "reads_config" | "gated_by_flag" | "secret_in_file"
  | "caches" | "reads_cache" | "invalidates"
  | "publishes_to" | "subscribes_to"
  // Operations layer — errors
  | "raises" | "handles" | "wraps" | "swallows" | "recovers" | "error_path"
  // Operations layer — observability
  | "logs" | "instruments" | "enriches_span" | "emits_metric" | "alerts_on"
  // Operations layer — ownership / docs
  | "owns" | "owned_by" | "part_of";

// Optional knowledge metadata for article/entity/topic/claim/source nodes
export interface KnowledgeMeta {
  wikilinks?: string[];
  backlinks?: string[];
  category?: string;
  content?: string;
}

// Optional domain metadata for domain/flow/step nodes
export interface DomainMeta {
  entities?: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  entryPoint?: string;
  entryType?: "http" | "cli" | "event" | "cron" | "manual";
}

// GraphNode with 21 types: 5 code + 8 non-code + 3 domain + 5 knowledge
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;
  domainMeta?: DomainMeta;
  knowledgeMeta?: KnowledgeMeta;
  // ---- Operations-layer (300-series) optional metadata --------------------
  // All optional + additive: present only on operations-layer node-types.
  /** Sub-kind discriminator, e.g. endpoint kind "http"|"cli"|"cron"|"queue"|"grpc"|"lambda", finding kind "smell"|"vuln"|"mutant". */
  kind?: string;
  /** HTTP method for endpoint/route nodes (GET/POST/...). */
  httpMethod?: string;
  /** Route/path or normalized identity (e.g. http.route, db.collection.name). */
  path?: string;
  /** Severity for finding/error_type/alert nodes (e.g. "info"|"warning"|"error"|"critical"). */
  severity?: string;
  /** Generic bag for type-specific metadata (columns, flag keys, topic names, etc.). */
  attrs?: Record<string, unknown>;
}

// GraphEdge with rich relationship modeling
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  weight: number; // 0-1
  // ---- Operations-layer (300-series) optional metadata --------------------
  /** Ordering index for ordered edges (e.g. passes_through middleware pipeline). */
  ordinal?: number;
  /** Access mode for data edges (queries_table / used_by). */
  access?: "read" | "write";
  /** Confidence 0–1 for inferred edges (e.g. inferred_fk). */
  confidence?: number;
}

// Layer (logical grouping)
export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

// TourStep (for learn mode)
export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

// ProjectMeta
export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash: string;
}

// Root KnowledgeGraph
export interface KnowledgeGraph {
  version: string;
  kind?: "codebase" | "knowledge";
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}

// Theme configuration (for dashboard customization)
export interface ThemeConfig {
  presetId: string;
  accentId: string;
}

// AnalysisMeta (for persistence)
export interface AnalysisMeta {
  lastAnalyzedAt: string;
  gitCommitHash: string;
  version: string;
  analyzedFiles: number;
  theme?: ThemeConfig;
}

// Project config (for auto-update opt-in and language preference)
export interface ProjectConfig {
  autoUpdate: boolean;
  outputLanguage?: string;
}

// Non-code structural sub-interfaces
export interface SectionInfo {
  name: string;
  level: number;
  lineRange: [number, number];
}

export interface DefinitionInfo {
  name: string;
  /** Parser-reported definition kind. Known values: "table", "view", "index", "message", "enum", "type", "input", "interface", "union", "scalar", "variable", "output", "resource", "data", "section", "target", "stage" */
  kind: string;
  lineRange: [number, number];
  fields: string[];
}

export interface ServiceInfo {
  name: string;
  image?: string;
  ports: number[];
  lineRange?: [number, number];
}

export interface EndpointInfo {
  method?: string;
  path: string;
  lineRange: [number, number];
}

export interface StepInfo {
  name: string;
  lineRange: [number, number];
}

export interface ResourceInfo {
  name: string;
  kind: string;
  lineRange: [number, number];
}

export interface ReferenceResolution {
  source: string;
  target: string;
  referenceType: string; // "file", "image", "schema", "service"
  line?: number;
}

// Plugin interfaces
export interface StructuralAnalysis {
  functions: Array<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string }>;
  classes: Array<{ name: string; lineRange: [number, number]; methods: string[]; properties: string[] }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number }>;
  exports: Array<{ name: string; lineNumber: number; isDefault?: boolean }>;
  // Non-code structural data (all optional for backward compat)
  sections?: SectionInfo[];
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
}

export interface ImportResolution {
  source: string;
  resolvedPath: string;
  specifiers: string[];
}

export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
}

export interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];
}

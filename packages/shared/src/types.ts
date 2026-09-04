export interface CaptureRecord {
  id: string;
  traceId: string;
  prompt: ChatMessage[];
  response: unknown;
  model: string;
  provider: string;
  costCents: number;
  latencyMs: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  frozenAt: string;
  windowStart: string;
  windowEnd: string;
  itemCount: number;
  createdAt: string;
}

export interface DatasetItem {
  id: string;
  datasetId: string;
  captureId: string;
  ordinal: number;
}

export interface ReplayRun {
  id: string;
  datasetId: string;
  candidateModel: string;
  baselineModel: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ReplayResult {
  id: string;
  replayRunId: string;
  datasetItemId: string;
  candidateResponse: unknown;
  baselineResponse: unknown;
  candidateScore: number;
  baselineScore: number;
  candidateCostCents: number;
  candidateLatencyMs: number;
  createdAt: string;
}

export interface PromotionReport {
  id: string;
  replayRunId: string;
  delta: number;
  threshold: number;
  decision: "promote" | "rollback";
  candidateModel: string;
  baselineModel: string;
  summary: PromotionSummary;
  signature: string;
  createdAt: string;
}

export interface PromotionSummary {
  totalItems: number;
  candidateAvgScore: number;
  baselineAvgScore: number;
  candidateAvgCostCents: number;
  baselineAvgCostCents: number;
  candidateAvgLatencyMs: number;
  baselineAvgLatencyMs: number;
  regressionCount: number;
}

export interface AuditLogEntry {
  id: string;
  action: "capture" | "freeze" | "replay" | "promote" | "rollback" | "eval" | "anomaly" | "multi-turn-attack";
  resourceType: string;
  resourceId: string;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface Trace {
  id: string;
  name: string;
  startTime: string;
  endTime: string | null;
  status: "running" | "completed" | "error";
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown>;
  userId: string | null;
  sessionId: string | null;
  createdAt: string;
}

export interface Span {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  startTime: string;
  endTime: string | null;
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Generation {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  model: string;
  prompt: ChatMessage[];
  completion: unknown;
  tokenCounts: TokenCounts;
  costCents: number;
  latencyMs: number;
  provider: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TokenCounts {
  input: number;
  output: number;
  total: number;
}

export interface TracingSession {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Score {
  id: string;
  name: string;
  value: number;
  traceId: string;
  spanId: string | null;
  generationId: string | null;
  source: "automated" | "manual";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Env {
  DB: D1Database;
  CAPTURES: R2Bucket;
  GATELANE_KV: KVNamespace;
  GATELANE_CAPTURE_TOKEN: string;
  GATELANE_JUDGE_PROVIDER: string;
  GATELANE_JUDGE_API_KEY: string;
  GATELANE_JUDGE_MODEL: string;
}

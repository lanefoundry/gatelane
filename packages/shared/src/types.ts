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
  action: "capture" | "freeze" | "replay" | "promote" | "rollback";
  resourceType: string;
  resourceId: string;
  actor: string;
  detail: Record<string, unknown>;
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

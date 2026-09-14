/** Cloudflare Workers environment bindings. */
export interface Env {
  DB: D1Database;
  CAPTURES: R2Bucket;
  GATELANE_KV: KVNamespace;
  GATELANE_CAPTURE_TOKEN: string;
  GATELANE_JUDGE_PROVIDER: string;
  GATELANE_JUDGE_API_KEY: string;
  GATELANE_JUDGE_MODEL: string;
}

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
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface CaptureInput {
  prompt: Array<{ role: string; content: string }>;
  model: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

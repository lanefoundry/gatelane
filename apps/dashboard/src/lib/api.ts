const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function getDatasets() {
  return fetchJson<{ datasets: unknown[] }>("/v1/datasets");
}

export function getDataset(id: string) {
  return fetchJson<unknown>(`/v1/datasets/${id}`);
}

export function getReplayRuns() {
  return fetchJson<{ runs: unknown[] }>("/v1/replay-runs");
}

export function getReplayRun(id: string) {
  return fetchJson<unknown>(`/v1/replay-runs/${id}`);
}

export function getPromotions() {
  return fetchJson<{ promotions: unknown[] }>("/v1/promotions");
}

export function getPromotion(id: string) {
  return fetchJson<unknown>(`/v1/promotions/${id}`);
}

export function getAuditLog() {
  return fetchJson<{ entries: unknown[] }>("/v1/audit-log");
}

export function getTraces(params?: { tag?: string; since?: string; until?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.since) qs.set("since", params.since);
  if (params?.until) qs.set("until", params.until);
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.size > 0 ? `?${qs.toString()}` : "";
  return fetchJson<{ traces: TraceRecord[] }>(`/v1/traces${query}`);
}

export interface TraceRecord {
  id: string;
  name: string;
  userId?: string;
  sessionId?: string;
  input: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  scores?: Record<string, number>;
  startTime: string;
  endTime?: string;
  spans: SpanRecord[];
  tags?: string[];
}

export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: string;
  startTime: string;
  endTime?: string;
  generations: GenerationRecord[];
}

export interface GenerationRecord {
  id: string;
  spanId: string;
  name: string;
  model: string;
  input: unknown;
  output?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  metadata?: Record<string, unknown>;
  startTime: string;
  endTime: string;
  level?: string;
}

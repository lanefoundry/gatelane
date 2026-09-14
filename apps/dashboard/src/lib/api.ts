const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function getCaptures(params?: { since?: string; model?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.since) qs.set("since", params.since);
  if (params?.model) qs.set("model", params.model);
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return fetchJson<{ captures: Record<string, unknown>[] }>(`/v1/captures${query ? `?${query}` : ""}`);
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

export function getCanaries() {
  return fetchJson<{ canaries: Record<string, unknown>[] }>("/v1/canaries");
}

export function getCanary(id: string) {
  return fetchJson<Record<string, unknown>>(`/v1/canaries/${id}`);
}

export async function advanceCanary(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/v1/canaries/${id}/advance`, { method: "POST" });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function rollbackCanaryApi(id: string, reason: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/v1/canaries/${id}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

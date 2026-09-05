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

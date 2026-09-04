import type { CaptureRecord, Env } from "@gatelane/shared";
import type { TestCase, GenerateTestCasesOptions } from "./types.js";

export async function generateTestCasesFromCaptures(
  env: Env,
  options: GenerateTestCasesOptions = {},
): Promise<TestCase[]> {
  const limit = options.limit ?? 100;
  const rows = options.datasetId
    ? await queryByDataset(env, options.datasetId, limit)
    : await queryCaptures(env, limit);

  const filtered = applyFilters(rows, options.filters);

  return filtered.map((record) => {
    const tc: TestCase = {
      id: crypto.randomUUID(),
      input: record.prompt,
      metadata: {
        captureId: record.id,
        model: record.model,
        provider: record.provider,
        costCents: record.costCents,
        latencyMs: record.latencyMs,
        capturedAt: record.createdAt,
      },
    };

    if (options.includeExpected) {
      tc.expectedOutput = record.response;
    }

    return tc;
  });
}

interface CaptureRow {
  id: string;
  trace_id: string;
  prompt: string;
  response: string;
  model: string;
  provider: string;
  cost_cents: number;
  latency_ms: number;
  metadata: string;
  created_at: string;
}

function rowToRecord(row: CaptureRow): CaptureRecord {
  return {
    id: row.id,
    traceId: row.trace_id,
    prompt: JSON.parse(row.prompt),
    response: JSON.parse(row.response),
    model: row.model,
    provider: row.provider,
    costCents: row.cost_cents,
    latencyMs: row.latency_ms,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
  };
}

async function queryCaptures(env: Env, limit: number): Promise<CaptureRecord[]> {
  const result = await env.DB.prepare(
    `SELECT id, trace_id, prompt, response, model, provider, cost_cents, latency_ms, metadata, created_at
     FROM captures ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<CaptureRow>();

  return (result.results ?? []).map(rowToRecord);
}

async function queryByDataset(env: Env, datasetId: string, limit: number): Promise<CaptureRecord[]> {
  const result = await env.DB.prepare(
    `SELECT c.id, c.trace_id, c.prompt, c.response, c.model, c.provider, c.cost_cents, c.latency_ms, c.metadata, c.created_at
     FROM captures c
     JOIN dataset_items di ON di.capture_id = c.id
     WHERE di.dataset_id = ?
     ORDER BY di.ordinal
     LIMIT ?`,
  )
    .bind(datasetId, limit)
    .all<CaptureRow>();

  return (result.results ?? []).map(rowToRecord);
}

function applyFilters(
  records: CaptureRecord[],
  filters?: GenerateTestCasesOptions["filters"],
): CaptureRecord[] {
  if (!filters) return records;

  return records.filter((r) => {
    if (filters.model && r.model !== filters.model) return false;
    if (filters.maxCostCents != null && r.costCents > filters.maxCostCents) return false;
    if (filters.minScore != null) {
      const score = r.metadata?.score as number | undefined;
      if (score == null || score < filters.minScore) return false;
    }
    return true;
  });
}

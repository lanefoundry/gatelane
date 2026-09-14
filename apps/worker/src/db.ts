import type { Env, CaptureInput, CaptureRecord, AuditLogEntry } from './types.js';

function inferProvider(model: string): string {
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  return 'unknown';
}

export async function capture(
  env: Env,
  input: CaptureInput,
  execute: () => Promise<unknown>,
): Promise<{ response: unknown; record: CaptureRecord }> {
  const id = crypto.randomUUID();
  const start = Date.now();
  const response = await execute();
  const latencyMs = Date.now() - start;

  const record: CaptureRecord = {
    id,
    traceId: (input.metadata?.traceId as string) ?? id,
    prompt: input.prompt.map((m) => ({
      role: m.role as CaptureRecord['prompt'][0]['role'],
      content: m.content,
    })),
    response,
    model: input.model,
    provider: input.provider ?? inferProvider(input.model),
    costCents: 0,
    latencyMs,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };

  await Promise.all([
    env.DB.prepare(
      `INSERT INTO captures (id, trace_id, prompt, response, model, provider, cost_cents, latency_ms, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        record.id, record.traceId,
        JSON.stringify(record.prompt), JSON.stringify(record.response),
        record.model, record.provider, record.costCents, record.latencyMs,
        JSON.stringify(record.metadata), record.createdAt,
      )
      .run(),
    env.CAPTURES.put(`captures/${record.id}.json`, JSON.stringify(record)),
  ]);

  return { response, record };
}

export async function writeAuditLog(
  env: Env,
  entry: Omit<AuditLogEntry, 'id' | 'createdAt'>,
): Promise<AuditLogEntry> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, entry.action, entry.resourceType, entry.resourceId, entry.actor, JSON.stringify(entry.detail), createdAt)
    .run();

  return { ...entry, id, createdAt };
}

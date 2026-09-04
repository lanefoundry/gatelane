import type { Generation, ChatMessage, Env } from "@gatelane/shared";

export interface CreateGenerationOpts {
  traceId: string;
  name: string;
  model: string;
  prompt: Array<{ role: string; content: string }>;
  parentSpanId?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export async function createGeneration(
  env: Env,
  opts: CreateGenerationOpts,
  execute: () => Promise<unknown>,
): Promise<Generation> {
  const id = crypto.randomUUID();
  const start = Date.now();

  const completion = await execute();

  const latencyMs = Date.now() - start;
  const now = new Date().toISOString();

  const prompt: ChatMessage[] = opts.prompt.map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  const generation: Generation = {
    id,
    traceId: opts.traceId,
    parentSpanId: opts.parentSpanId ?? null,
    name: opts.name,
    model: opts.model,
    prompt,
    completion,
    tokenCounts: { input: 0, output: 0, total: 0 },
    costCents: 0,
    latencyMs,
    provider: opts.provider ?? inferProvider(opts.model),
    metadata: opts.metadata ?? {},
    createdAt: now,
  };

  await env.DB.prepare(
    `INSERT INTO generations (id, trace_id, parent_span_id, name, model, prompt, completion, token_input, token_output, token_total, cost_cents, latency_ms, provider, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      generation.id,
      generation.traceId,
      generation.parentSpanId,
      generation.name,
      generation.model,
      JSON.stringify(generation.prompt),
      JSON.stringify(generation.completion),
      generation.tokenCounts.input,
      generation.tokenCounts.output,
      generation.tokenCounts.total,
      generation.costCents,
      generation.latencyMs,
      generation.provider,
      JSON.stringify(generation.metadata),
      generation.createdAt,
    )
    .run();

  return generation;
}

function inferProvider(model: string): string {
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "google";
  return "unknown";
}

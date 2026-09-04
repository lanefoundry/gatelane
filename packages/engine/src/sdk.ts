import type { Env, Trace, Span, Generation } from "@gatelane/shared";
import { createTrace, endTrace } from "./trace.js";
import { createSpan, endSpan } from "./span.js";
import { createGeneration, type CreateGenerationOpts } from "./generation.js";

export interface TraceContext {
  traceId: string;
  spanId?: string;
}

export interface GenerationResult {
  generation: Generation;
  completion: unknown;
}

export function withTracing<TArgs extends unknown[], TReturn>(
  env: Env,
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const trace = await createTrace(env, { name, input: args });
    try {
      const result = await fn(...args);
      await endTrace(env, trace.id, "completed", result);
      return result;
    } catch (err) {
      await endTrace(env, trace.id, "error", { error: String(err) });
      throw err;
    }
  };
}

export function withSpan<TArgs extends unknown[], TReturn>(
  env: Env,
  traceId: string,
  name: string,
  fn: (ctx: TraceContext, ...args: TArgs) => Promise<TReturn>,
  parentSpanId?: string,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const span = await createSpan(env, { traceId, name, parentSpanId, input: args });
    try {
      const result = await fn({ traceId, spanId: span.id }, ...args);
      await endSpan(env, span.id, result);
      return result;
    } catch (err) {
      await endSpan(env, span.id, { error: String(err) });
      throw err;
    }
  };
}

export interface WithGenerationOpts {
  traceId: string;
  name: string;
  model: string;
  parentSpanId?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export function withGeneration(
  env: Env,
  opts: WithGenerationOpts,
  fn: (messages: Array<{ role: string; content: string }>) => Promise<unknown>,
): (messages: Array<{ role: string; content: string }>) => Promise<GenerationResult> {
  return async (messages) => {
    let completion: unknown;
    const generation = await createGeneration(
      env,
      {
        traceId: opts.traceId,
        name: opts.name,
        model: opts.model,
        prompt: messages,
        parentSpanId: opts.parentSpanId,
        provider: opts.provider,
        metadata: opts.metadata,
      },
      () => fn(messages).then((result) => { completion = result; return result; }),
    );
    return { generation, completion };
  };
}

type SpanFn<T> = (ctx: TraceContext) => Promise<T>;

interface SpanStep {
  name: string;
  fn: SpanFn<unknown>;
}

interface TracedBuilder {
  span: (name: string, fn: SpanFn<unknown>) => TracedBuilder;
  run: (input?: unknown) => Promise<{ trace: Trace; results: unknown[] }>;
}

export function traced(env: Env, name: string): TracedBuilder {
  const steps: SpanStep[] = [];

  const builder: TracedBuilder = {
    span(stepName: string, fn: SpanFn<unknown>): TracedBuilder {
      steps.push({ name: stepName, fn });
      return builder;
    },

    async run(input?: unknown): Promise<{ trace: Trace; results: unknown[] }> {
      const trace = await createTrace(env, { name, input });
      const results: unknown[] = [];
      let lastSpanId: string | undefined;

      try {
        for (const step of steps) {
          const span = await createSpan(env, {
            traceId: trace.id,
            name: step.name,
            parentSpanId: lastSpanId,
            input: results.length > 0 ? results[results.length - 1] : input,
          });
          try {
            const result = await step.fn({ traceId: trace.id, spanId: span.id });
            await endSpan(env, span.id, result);
            results.push(result);
            lastSpanId = span.id;
          } catch (err) {
            await endSpan(env, span.id, { error: String(err) });
            throw err;
          }
        }
        const finalTrace = await endTrace(env, trace.id, "completed", results[results.length - 1]);
        return { trace: finalTrace, results };
      } catch (err) {
        const finalTrace = await endTrace(env, trace.id, "error", { error: String(err) });
        throw Object.assign(err as Error, { trace: finalTrace });
      }
    },
  };

  return builder;
}

/**
 * OpenTelemetry tracing utilities for the gate engine.
 *
 * Provides a simple span wrapper that emits spans for each gate stage.
 * Uses console exporter in development, Cloudflare Logpush in production.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import { trace, SpanStatusCode, SpanKind, Span } from '@opentelemetry/api';
import { NodeTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';

let tracerProvider: NodeTracerProvider | null = null;
let initialized = false;

/** Initialize OTel tracer provider with console exporter (dev) or custom exporter (prod). */
export function initTracing(serviceName = 'gatelane-engine', exporter?: { export: (spans: unknown[]) => Promise<void>; shutdown: () => Promise<void> }): void {
  if (initialized) return;

  const spanProcessor = exporter
    // OTel SpanProcessor expects a concrete processor; exporter is structurally compatible.
    ? new SimpleSpanProcessor(exporter as unknown as Parameters<typeof SimpleSpanProcessor>[0])
    : new SimpleSpanProcessor(new ConsoleSpanExporter());

  tracerProvider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': serviceName,
    }),
    spanProcessors: [spanProcessor],
  });

  tracerProvider.register();
  initialized = true;
}

/** Get a tracer for the gate engine. */
export function getTracer(): ReturnType<typeof trace.getTracer> {
  return trace.getTracer('gatelane-engine');
}

/** Gate stage names for span naming. */
export type GateStage = 'replay' | 'judge' | 'compare' | 'sign' | 'evaluate';

/** Run a function within a named span for a gate stage. */
export async function withGateSpan<T>(
  stage: GateStage,
  gateRunId: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(`gate.${stage}`, { kind: SpanKind.INTERNAL }, async (span) => {
    try {
      span.setAttribute('gate.run_id', gateRunId);
      span.setAttribute('gate.stage', stage);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Shutdown the tracer provider (for clean shutdown). */
export async function shutdownTracing(): Promise<void> {
  if (tracerProvider) {
    await tracerProvider.shutdown();
    initialized = false;
    tracerProvider = null;
  }
}
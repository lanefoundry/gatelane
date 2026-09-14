/**
 * OTel export — convert Turn[] traces to OpenTelemetry spans and send
 * to any OTLP-compatible backend (Langfuse, Jaeger, Datadog, Grafana Tempo, etc.).
 *
 * Uses GenAI semantic conventions for LLM-specific attributes.
 *
 * @example
 * ```ts
 * import { exportTurnsToOTel } from '@lanefoundry/gatelane-engine';
 *
 * await exportTurnsToOTel(turns, {
 *   endpoint: 'https://cloud.langfuse.com/api/public/otel',
 *   headers: { Authorization: 'Basic <base64(publicKey:secretKey)>' },
 * });
 * ```
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { Turn } from '@lanefoundry/gatelane-sdk/capture';

export type OTelExportConfig = {
  /** OTLP/HTTP endpoint, e.g. https://cloud.langfuse.com/api/public/otel */
  endpoint: string;
  /** Custom headers, e.g. Authorization for Langfuse/Datadog. */
  headers?: Record<string, string>;
  /** OTel service name (default: "gatelane"). */
  service_name?: string;
};

const SPAN_KIND_MAP: Record<string, SpanKind> = {
  llm: SpanKind.CLIENT,
  tool: SpanKind.INTERNAL,
  agent: SpanKind.INTERNAL,
  retriever: SpanKind.CLIENT,
  guardrail: SpanKind.INTERNAL,
};

/**
 * Export Turn[] traces to an OTLP-compatible backend.
 *
 * Creates a temporary TracerProvider with an OTLP/HTTP exporter, converts
 * each Turn with a span_id into an OTel span (using GenAI semantic
 * conventions), exports them, and shuts down.
 */
export async function exportTurnsToOTel(
  turns: ReadonlyArray<Turn>,
  config: OTelExportConfig,
): Promise<{ exported: number }> {
  const spannedTurns = turns.filter((t) => t.span_id);
  if (spannedTurns.length === 0) {
    return { exported: 0 };
  }

  const exporter = new OTLPTraceExporter({
    url: config.endpoint.replace(/\/$/, '') + '/v1/traces',
    headers: config.headers,
  });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': config.service_name ?? 'gatelane',
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const tracer = provider.getTracer('gatelane-otel-export');

  // Build a map of span_id → Turn for parent lookup
  const spanMap = new Map<string, Turn>();
  for (const turn of spannedTurns) {
    spanMap.set(turn.span_id!, turn);
  }

  // Process root spans first, then children, to maintain parent-child relationships.
  // OTel SDK handles span linking via context, so we process in order and
  // create spans with explicit start/end times.
  const roots = spannedTurns.filter((t) => !t.parent_span_id);
  const children = spannedTurns.filter((t) => t.parent_span_id);

  let exported = 0;

  for (const turn of [...roots, ...children]) {
    const spanKind = SPAN_KIND_MAP[turn.span_kind ?? 'agent'] ?? SpanKind.INTERNAL;
    const spanName = buildSpanName(turn);
    const startTime = turn.started_at ? new Date(turn.started_at) : new Date();

    const span = tracer.startSpan(spanName, {
      kind: spanKind,
      startTime,
    });

    // GenAI semantic conventions
    if (turn.model) {
      span.setAttribute('gen_ai.request.model', turn.model);
    }
    if (turn.tokens_in !== undefined) {
      span.setAttribute('gen_ai.usage.input_tokens', turn.tokens_in);
    }
    if (turn.tokens_out !== undefined) {
      span.setAttribute('gen_ai.usage.output_tokens', turn.tokens_out);
    }
    if (turn.cost_usd !== undefined) {
      span.setAttribute('gen_ai.usage.cost', turn.cost_usd);
    }

    // gatelane-specific attributes
    span.setAttribute('gatelane.role', turn.role);
    if (turn.span_kind) {
      span.setAttribute('gatelane.span_kind', turn.span_kind);
    }
    if (turn.span_id) {
      span.setAttribute('gatelane.span_id', turn.span_id);
    }
    if (turn.parent_span_id) {
      span.setAttribute('gatelane.parent_span_id', turn.parent_span_id);
    }
    if (turn.latency_ms !== undefined) {
      span.setAttribute('gatelane.latency_ms', turn.latency_ms);
    }

    // Content (opt-in via GenAI conventions — content is a span event)
    if (turn.content) {
      span.addEvent(turn.role === 'assistant' ? 'gen_ai.completion' : 'gen_ai.prompt', {
        'gen_ai.content': turn.content.slice(0, 4096),
      });
    }

    // Tool calls
    if (turn.tool_calls) {
      for (const tc of turn.tool_calls) {
        span.addEvent('gen_ai.tool_call', {
          'gen_ai.tool.name': tc.name,
          'gen_ai.tool.call_id': tc.id,
          'gen_ai.tool.arguments': tc.arguments.slice(0, 4096),
        });
      }
    }

    // Tool result (for role=tool turns)
    if (turn.role === 'tool' && turn.name) {
      span.setAttribute('gen_ai.tool.name', turn.name);
      if (turn.tool_call_id) {
        span.setAttribute('gen_ai.tool.call_id', turn.tool_call_id);
      }
    }

    // Error status
    if (turn.status === 'error' || turn.status === 'timeout') {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: turn.error?.message ?? turn.status,
      });
      if (turn.error) {
        span.recordException({
          name: turn.error.type,
          message: turn.error.message,
          stack: turn.error.stack,
        });
      }
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    const endTime = turn.completed_at
      ? new Date(turn.completed_at)
      : turn.latency_ms !== undefined
        ? new Date(startTime.getTime() + turn.latency_ms)
        : new Date();
    span.end(endTime);
    exported++;
  }

  // Flush and shutdown
  await provider.forceFlush();
  await provider.shutdown();

  return { exported };
}

function buildSpanName(turn: Turn): string {
  if (turn.span_kind === 'llm' && turn.model) {
    return `llm.${turn.model}`;
  }
  if (turn.span_kind === 'tool' && turn.name) {
    return `tool.${turn.name}`;
  }
  if (turn.span_kind) {
    return turn.span_kind;
  }
  return `${turn.role}`;
}

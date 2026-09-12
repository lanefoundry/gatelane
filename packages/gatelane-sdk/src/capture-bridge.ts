/**
 * Capture → Trace bridge.
 *
 * Converts CapturedCall records (from the capture SDK) into TraceRecord
 * (used by the eval/compare pipeline), so production captures can feed
 * into `gatelane eval --from-captures` and `gatelane compare`.
 */

import type { CapturedCall } from './capture.js';
import type { TraceRecord } from './tracing.js';

export function captureToTrace(call: CapturedCall, tag?: string): TraceRecord {
  const userMessage = call.input.prompt.find((m) => m.role === 'user');
  const input = userMessage?.content ?? call.input.prompt.map((m) => m.content).join('\n');

  return {
    id: call.id,
    name: 'capture',
    input,
    output: typeof call.output === 'string' ? call.output : JSON.stringify(call.output),
    startTime: call.started_at,
    endTime: call.completed_at,
    tags: tag ? [tag] : [],
    metadata: {
      model: call.input.model,
      cost_usd: call.cost_usd,
      source: 'capture-bridge',
      ...call.input.metadata,
    },
    spans: [
      {
        id: `${call.id}-span`,
        traceId: call.id,
        parentSpanId: null,
        name: 'llm-call',
        input: call.input.prompt,
        output: call.output,
        startTime: call.started_at,
        endTime: call.completed_at,
        generations: [
          {
            id: `${call.id}-gen`,
            spanId: `${call.id}-span`,
            name: 'response',
            model: call.input.model ?? 'unknown',
            input: call.input.prompt,
            output: typeof call.output === 'string' ? call.output : JSON.stringify(call.output),
            startTime: call.started_at,
            endTime: call.completed_at,
          },
        ],
      },
    ],
  };
}

export function capturesToTraces(calls: ReadonlyArray<CapturedCall>, tag?: string): TraceRecord[] {
  const seen = new Set<string>();
  const traces: TraceRecord[] = [];
  for (const call of calls) {
    const userMessage = call.input.prompt.find((m) => m.role === 'user')?.content;
    const dedupeKey = userMessage ?? call.id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    traces.push(captureToTrace(call, tag));
  }
  return traces;
}

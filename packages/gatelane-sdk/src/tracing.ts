/**
 * Tracing SDK — drop-in replacement for Langfuse's trace/span/generation API.
 *
 * Collects a tree of spans per request, stores them via the active TraceStore.
 * Designed to match Langfuse's function signature so nobodyclimb (and similar
 * projects) can switch by changing one import path.
 *
 * Storage: filesystem (local dev) or HTTP (production Worker).
 * Each trace is one JSON file containing the trace metadata + all spans.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SpanLevel = 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR';

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
  level?: SpanLevel;
}

export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: SpanLevel;
  startTime: string;
  endTime?: string;
  generations: GenerationRecord[];
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

// ─── Store interface ──────────────────────────────────────────────────────────

export interface TraceStore {
  write(trace: TraceRecord): Promise<void>;
  read(id: string): Promise<TraceRecord | null>;
  list(filter?: TraceListFilter): Promise<TraceRecord[]>;
  readonly name: string;
}

export interface TraceListFilter {
  since?: string;
  until?: string;
  limit?: number;
  name?: string;
  tags?: string[];
}

// ─── Span client (mirrors Langfuse's LangfuseSpanClient) ─────────────────────

export class GatelaneSpan {
  readonly id: string;
  readonly traceId: string;
  private readonly _trace: GatelaneTrace;
  private readonly _record: SpanRecord;

  constructor(trace: GatelaneTrace, parentSpanId: string | null, name: string, input?: unknown) {
    this.id = crypto.randomUUID();
    this.traceId = trace.id;
    this._trace = trace;
    this._record = {
      id: this.id,
      traceId: trace.id,
      parentSpanId,
      name,
      input,
      startTime: new Date().toISOString(),
      generations: [],
    };
    trace._addSpan(this._record);
  }

  span(opts: { name: string; input?: unknown }): GatelaneSpan {
    return new GatelaneSpan(this._trace, this.id, opts.name, opts.input);
  }

  generation(opts: {
    name: string;
    model: string;
    input: unknown;
    output?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    metadata?: Record<string, unknown>;
    startTime?: Date;
    endTime?: Date;
    level?: SpanLevel;
  }): void {
    const now = new Date().toISOString();
    this._record.generations.push({
      id: crypto.randomUUID(),
      spanId: this.id,
      name: opts.name,
      model: opts.model,
      input: opts.input,
      output: opts.output,
      usage: opts.usage,
      metadata: opts.metadata,
      startTime: opts.startTime?.toISOString() ?? now,
      endTime: opts.endTime?.toISOString() ?? now,
      level: opts.level,
    });
  }

  end(opts: { output?: unknown; metadata?: Record<string, unknown>; level?: SpanLevel } = {}): void {
    this._record.endTime = new Date().toISOString();
    this._record.output = opts.output;
    if (opts.metadata) this._record.metadata = { ...this._record.metadata, ...opts.metadata };
    if (opts.level) this._record.level = opts.level;
  }
}

// ─── Trace client (mirrors Langfuse's LangfuseTraceClient) ───────────────────

export class GatelaneTrace {
  readonly id: string;
  private readonly _record: TraceRecord;

  constructor(opts: {
    name: string;
    userId?: string;
    sessionId?: string;
    input: unknown;
    metadata?: Record<string, unknown>;
    tags?: string[];
  }) {
    this.id = crypto.randomUUID();
    this._record = {
      id: this.id,
      name: opts.name,
      userId: opts.userId,
      sessionId: opts.sessionId,
      input: opts.input,
      metadata: opts.metadata,
      startTime: new Date().toISOString(),
      spans: [],
      tags: opts.tags,
    };
  }

  span(opts: { name: string; input?: unknown }): GatelaneSpan {
    return new GatelaneSpan(this, null, opts.name, opts.input);
  }

  generation(opts: {
    name: string;
    model: string;
    input: unknown;
    output?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    metadata?: Record<string, unknown>;
    startTime?: Date;
    endTime?: Date;
    level?: SpanLevel;
  }): void {
    const rootSpan = new GatelaneSpan(this, null, opts.name);
    rootSpan.generation(opts);
    rootSpan.end();
  }

  score(name: string, value: number): void {
    if (!this._record.scores) this._record.scores = {};
    this._record.scores[name] = value;
  }

  end(output?: unknown): void {
    this._record.endTime = new Date().toISOString();
    if (output !== undefined) this._record.output = output;
  }

  /** @internal — used by GatelaneSpan to register itself */
  _addSpan(span: SpanRecord): void {
    this._record.spans.push(span);
  }

  toJSON(): TraceRecord {
    return { ...this._record };
  }
}

// ─── Client (mirrors Langfuse client) ────────────────────────────────────────

export class GatelaneTracer {
  private _store: TraceStore;
  private _pending: Promise<void>[] = [];

  constructor(store: TraceStore) {
    this._store = store;
  }

  trace(opts: {
    name: string;
    userId?: string;
    sessionId?: string;
    input: unknown;
    metadata?: Record<string, unknown>;
    tags?: string[];
  }): GatelaneTrace {
    return new GatelaneTrace(opts);
  }

  /** Queue a completed trace for storage. Non-blocking — errors go to stderr. */
  enqueue(trace: GatelaneTrace): void {
    const p = this._store.write(trace.toJSON()).catch((err) => {
      process.stderr.write(
        `[gatelane] trace write failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    });
    this._pending.push(p);
  }

  /** Flush all pending writes. Call in waitUntil() or at request end. */
  async flush(): Promise<void> {
    await Promise.all(this._pending);
    this._pending = [];
  }

  get store(): TraceStore {
    return this._store;
  }
}

// ─── Langfuse-compatible wrapper functions ───────────────────────────────────
// These match the exact signatures in nobodyclimb's utils/langfuse.ts
// so switching is a one-line import change.

export type GatelaneParent = GatelaneTrace | GatelaneSpan;

export function createGatelaneTracer(store: TraceStore): GatelaneTracer {
  return new GatelaneTracer(store);
}

export function createTrace(
  tracer: GatelaneTracer | null,
  opts: {
    name: string;
    userId?: string;
    sessionId?: string;
    input: unknown;
    metadata?: Record<string, unknown>;
    tags?: string[];
  },
): GatelaneTrace | null {
  if (!tracer) return null;
  return tracer.trace(opts);
}

export function startSpan(
  parent: GatelaneParent | null,
  name: string,
  input?: unknown,
): GatelaneSpan | null {
  if (!parent) return null;
  return parent.span({ name, input });
}

export function endSpan(
  span: GatelaneSpan | null,
  opts: { output?: unknown; metadata?: Record<string, unknown>; level?: SpanLevel } = {},
): void {
  if (!span) return;
  span.end(opts);
}

export function logGeneration(
  parent: GatelaneParent | null,
  opts: {
    name: string;
    model: string;
    input: unknown;
    output?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    metadata?: Record<string, unknown>;
    startTime?: Date;
    endTime?: Date;
    level?: SpanLevel;
  },
): void {
  if (!parent) return;
  parent.generation(opts);
}

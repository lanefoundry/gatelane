/**
 * Capture SDK — one-line instrumentation for agent calls.
 *
 * Wraps an LLM/tool/judge call so gatelane can observe (and later replay) it.
 * Records go through the active StorageAdapter (in-memory by default; HTTP via
 * HttpStorage for production; filesystem via FilesystemStorage for local dev).
 *
 * @example
 * ```ts
 * import { capture, setStorage, HttpStorage } from "@lanefoundry/gatelane-sdk";
 *
 * // One-time setup: point capture at the production Worker.
 * setStorage(new HttpStorage({
 *   endpoint: process.env.GATELANE_ENDPOINT!,
 *   token: process.env.GATELANE_CAPTURE_TOKEN!,
 * }));
 *
 * // Now every call site uses the same wrapper.
 * const response = await capture({
 *   prompt: [{ role: "user", content: userInput }],
 *   model: "gpt-4o",
 *   metadata: { traceId: "...", agentVersion: "..." },
 * }, async () => openai.chat.completions.create({ ... }));
 * ```
 *
 * @see docs/prd.md §5.6 — SDK & API surface
 */

import { getStorage } from './storage.js';

import type { DatasetSourceKind } from './dataset.js';

/** A single step in a multi-turn agent trace.
 *
 * Flat turns array is the primary representation for eval/replay.
 * `span_id` + `parent_span_id` overlay a nested tree for OTel/APM export
 * without changing the storage format — consumers that only need the flat
 * list ignore the span fields; consumers that need the tree reconstruct it. */
export type Turn = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
  }>;
  readonly tool_call_id?: string;
  readonly name?: string;

  // ── Error tracking ──
  readonly status?: 'ok' | 'error' | 'timeout';
  readonly error?: {
    readonly type: string;
    readonly message: string;
    readonly stack?: string;
  };

  // ── Nested span overlay (OTel-compatible) ──
  readonly span_id?: string;
  readonly parent_span_id?: string;
  readonly span_kind?: 'llm' | 'tool' | 'agent' | 'retriever' | 'guardrail';
  readonly started_at?: string;
  readonly completed_at?: string;
  readonly cost_usd?: number;
  readonly latency_ms?: number;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
  readonly model?: string;
};

export type CaptureMetadata = {
  readonly traceId?: string;
  readonly agentVersion?: string;
  readonly dataset?: string;
  readonly source_kind?: DatasetSourceKind;
  /** Free-form metadata. */
  readonly [key: string]: unknown;
};

export type CaptureInput = {
  readonly prompt: ReadonlyArray<{ role: string; content: string }>;
  readonly model?: string;
  readonly metadata?: CaptureMetadata;
};

/** What the capture SDK stores per call. */
export type CapturedCall = {
  readonly id: string;
  readonly input: CaptureInput;
  readonly output: unknown;
  readonly started_at: string;
  readonly completed_at: string;
  readonly cost_usd: number;
  readonly latency_ms: number;
  /** Span kind: gate.replay, gate.compare, gate.pass, redteam.attack, redteam.judge. */
  readonly span_kind?: string;
  /** Full multi-turn agent trace. When present, this is the source of truth;
   *  `input` and `output` are derived summaries for backward compatibility. */
  readonly turns?: ReadonlyArray<Turn>;
  /** Overall trace outcome — derived from turns[].status. */
  readonly outcome?: 'success' | 'partial_failure' | 'failure';
  /** Top-level error summaries extracted from turns. */
  readonly errors?: ReadonlyArray<{
    readonly turn_index: number;
    readonly type: string;
    readonly message: string;
  }>;
};

export type CaptureOptions = {
  readonly span_kind?: string;
  /** If true, observe without writing. Used for SDK validation in prod. */
  readonly dry_run?: boolean;
  /** Full multi-turn agent trace. When provided, the trace is stored alongside
   *  the legacy input/output fields for backward compatibility. */
  readonly turns?: ReadonlyArray<Turn>;
};

/**
 * Wrap an LLM/tool/judge call so gatelane captures it.
 *
 * Production behavior: writes the record to the active StorageAdapter (HTTP → Worker → R2/D1).
 * Tests: in-memory adapter keeps everything in process.
 * Local dev without Worker: filesystem adapter.
 */
export async function capture<T>(
  input: CaptureInput,
  call: () => Promise<T>,
  options: CaptureOptions = {},
): Promise<T> {
  const started_at = new Date().toISOString();
  const start = performance.now();
  const output = await call();
  const latency_ms = performance.now() - start;
  const completed_at = new Date().toISOString();

  if (options.dry_run) {
    return output;
  }

  const record: CapturedCall = {
    id: crypto.randomUUID(),
    input,
    output,
    started_at,
    completed_at,
    cost_usd: 0, // placeholder; real impl reads from model registry
    latency_ms,
    ...(options.span_kind !== undefined ? { span_kind: options.span_kind } : {}),
    ...(options.turns !== undefined ? { turns: options.turns } : {}),
  };

  // Fire-and-await: a capture write failure must not break the user's call.
  // The Worker is the source of truth; SDK surfaces the error to stderr but
  // does NOT throw, so a flaky network does not turn into a broken agent.
  try {
    await getStorage().write(record);
  } catch (err) {
    process.stderr.write(
      `[gatelane] capture write failed (record id=${record.id}): ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return output;
}

/**
 * Wrap an existing agent function so every call is captured.
 * Sugar over {@link capture} for the common case.
 */
export function withCapture<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: { span_kind?: string } = {},
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    return capture(
      {
        prompt: [],
        metadata: { args: args.length },
      },
      () => fn(...args),
      options,
    );
  };
}
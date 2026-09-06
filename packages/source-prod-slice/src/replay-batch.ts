/**
 * replay-batch.ts — Replay a FrozenDataset against candidate models.
 *
 * Reuses the engine's replay() function with a deterministic seed for idempotency.
 * Returns ReplayResult with per-item responses, costs, latency, and determinism_score.
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { FrozenDataset, DatasetItem } from '@lanefoundry/gatelane-sdk';
import type { LLMCaller } from '@lanefoundry/gatelane-engine';
import { replay, type ReplayArgs, type ReplayResult } from '@lanefoundry/gatelane-engine';
/** Candidate configuration for replay. */
export type ReplayCandidate = {
  /** Unique candidate reference (e.g., "gpt-4o", "model:looplane-v3"). */
  ref: string;
  /** Model identifier for the LLM caller. */
  model: string;
  /** Optional system prompt override. */
  systemPrompt?: string;
  /** Sampling temperature. Default: 0.0 for determinism. */
  temperature?: number;
  /** Max tokens. */
  maxTokens?: number;
};

/** Configuration for batch replay. */
export type ReplayBatchArgs = {
  /** The frozen dataset to replay against. */
  dataset: FrozenDataset;
  /** Candidates to evaluate. */
  candidates: ReadonlyArray<ReplayCandidate>;
  /** LLM caller implementation (MockLLMCaller, OpenAIChatCaller, etc.). */
  caller: LLMCaller;
  /** Master seed for deterministic replay. Same seed = same results. */
  seed?: number;
  /** If true, replay each (candidate, item) twice to measure determinism. */
  measureDeterminism?: boolean;
  /** Optional custom message extractor from dataset items. */
  messagesFromItem?: (item: DatasetItem) => { role: 'system' | 'user' | 'assistant'; content: string }[];
};
/** Result of a batch replay operation. */
export type ReplayBatchResult = {
  /** Per-candidate replay results. */
  perCandidate: Record<string, ReplayResult>;
  /** Aggregated determinism score across all candidates. */
  overallDeterminismScore: number;
  /** Total cost across all candidates (USD). */
  totalCostUsd: number;
  /** Total latency across all candidates (ms). */
  totalLatencyMs: number;
  /** Timestamp of replay execution. */
  timestamp: string;
};

/**
 * Replay a frozen dataset against multiple candidates.
 *
 * This is a thin wrapper around the engine's replay() that:
 * 1. Converts ReplayCandidate[] to the engine's expected format.
 * 2. Runs replay for each candidate (can be parallelized in future).
 * 3. Aggregates results with overall metrics.
 * 4. Uses a stable seed per (candidate, item) for idempotency.
 */
export async function replayBatch(args: ReplayBatchArgs): Promise<ReplayBatchResult> {
  const { dataset, candidates, caller, seed = 0xC0FFEE, measureDeterminism = false, messagesFromItem } = args;

  const perCandidate: Record<string, ReplayResult> = {};
  let overallDeterminismScore = 0;
  let totalCostUsd = 0;
  let totalLatencyMs = 0;
  let totalRows = 0;

  for (const candidate of candidates) {
    const messagesFromItemFn = candidate.systemPrompt
      ? (item: DatasetItem): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> => {
          const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: candidate.systemPrompt! },
            { role: 'user', content: String(item.input) },
          ];
          return messages;
        }
      : messagesFromItem;

    const candidateConfig = {
      ref: candidate.ref,
      model: candidate.model,
      messages_from_item: messagesFromItemFn,
    };

    const replayArgs: ReplayArgs = {
      dataset,
      candidates: [candidateConfig],
      caller,
      seed,
      measureDeterminism,
    };

    const result = await replay(replayArgs);

    perCandidate[candidate.ref] = result;
    overallDeterminismScore += result.determinism_score * result.rows.length;
    totalCostUsd += result.total_cost_usd;
    totalLatencyMs += result.total_latency_ms;
    totalRows += result.rows.length;
  }

  return {
    perCandidate,
    overallDeterminismScore: totalRows > 0 ? overallDeterminismScore / totalRows : 0,
    totalCostUsd,
    totalLatencyMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Replay a single candidate for incremental evaluation.
 * Useful when adding a new candidate to an existing gate run.
 */
export async function replaySingle(
  dataset: FrozenDataset,
  candidate: ReplayCandidate,
  caller: LLMCaller,
  seed?: number,
  measureDeterminism?: boolean,
  messagesFromItem?: ReplayBatchArgs['messagesFromItem'],
): Promise<ReplayResult> {
  const result = await replayBatch({
    dataset,
    candidates: [candidate],
    caller,
    seed,
    measureDeterminism,
    messagesFromItem,
  });
  const replayResult = result.perCandidate[candidate.ref];
  if (!replayResult) {
    throw new Error(`Replay result not found for candidate: ${candidate.ref}`);
  }
  return replayResult;
}
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
import { type ReplayResult } from '@lanefoundry/gatelane-engine';
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
    messagesFromItem?: (item: DatasetItem) => {
        role: 'system' | 'user' | 'assistant';
        content: string;
    }[];
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
export declare function replayBatch(args: ReplayBatchArgs): Promise<ReplayBatchResult>;
/**
 * Replay a single candidate for incremental evaluation.
 * Useful when adding a new candidate to an existing gate run.
 */
export declare function replaySingle(dataset: FrozenDataset, candidate: ReplayCandidate, caller: LLMCaller, seed?: number, measureDeterminism?: boolean, messagesFromItem?: ReplayBatchArgs['messagesFromItem']): Promise<ReplayResult>;
//# sourceMappingURL=replay-batch.d.ts.map
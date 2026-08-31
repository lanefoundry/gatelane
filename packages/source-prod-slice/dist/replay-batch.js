/**
 * replay-batch.ts — Replay a FrozenDataset against candidate models.
 *
 * Reuses the engine's replay() function with a deterministic seed for idempotency.
 * Returns ReplayResult with per-item responses, costs, latency, and determinism_score.
 *
 * @see docs/prd.md §5.1 — The gate
 */
import { replay } from '@lanefoundry/gatelane-engine';
/**
 * Replay a frozen dataset against multiple candidates.
 *
 * This is a thin wrapper around the engine's replay() that:
 * 1. Converts ReplayCandidate[] to the engine's expected format.
 * 2. Runs replay for each candidate (can be parallelized in future).
 * 3. Aggregates results with overall metrics.
 * 4. Uses a stable seed per (candidate, item) for idempotency.
 */
export async function replayBatch(args) {
    const { dataset, candidates, caller, seed = 0xC0FFEE, measureDeterminism = false, messagesFromItem } = args;
    const perCandidate = {};
    let overallDeterminismScore = 0;
    let totalCostUsd = 0;
    let totalLatencyMs = 0;
    let totalRows = 0;
    for (const candidate of candidates) {
        const messagesFromItemFn = candidate.systemPrompt
            ? (item) => {
                const messages = [
                    { role: 'system', content: candidate.systemPrompt },
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
        const replayArgs = {
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
export async function replaySingle(dataset, candidate, caller, seed, measureDeterminism, messagesFromItem) {
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
//# sourceMappingURL=replay-batch.js.map
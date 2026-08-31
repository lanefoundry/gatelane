/**
 * @lanefoundry/source-prod-slice — Production slice tooling.
 *
 * Freeze, replay, compare, promote, and audit production traffic slices.
 *
 * @see docs/prd.md §5.2 — Three dataset sources (prod slice)
 */

export * from './freeze-slice.js';
export * from './replay-batch.js';
export * from './compare-scores.js';
export * from './promotion-decision.js';
export * from './signed-report.js';
export * from './canary-orchestrator.js';
export * from './audit-export.js';
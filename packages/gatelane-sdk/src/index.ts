/**
 * @lanefoundry/gatelane-sdk — promotion gate SDK.
 *
 * Public API for v0.0.1-dev. Engine wires up across W1–W6 per docs/roadmap.md.
 *
 * @see docs/prd.md §5.6 — SDK & API surface
 */

export * from './capture.js';
export * from './candidate.js';
export * from './dataset.js';
export * from './gate.js';
export * from './promotion.js';
export * from './storage.js';
export * from './storage-fs.js';
export * from './storage-http.js';
export * from './tracing.js';
export * from './trace-store-fs.js';
export * from './trace-store-http.js';
export * from './trace-compare.js';
export * from './eval-config.js';
export * from './eval-runner.js';
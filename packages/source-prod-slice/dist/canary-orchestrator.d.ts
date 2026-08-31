/**
 * canary-orchestrator.ts — Canary state machine: 10% → 24h observe → promote 100% or rollback.
 *
 * Manages the canary lifecycle with D1 persistence for durability.
 * States: pending → canary → observing → promoting → promoted | rolled_back | failed
 *
 * @see docs/prd.md §5.1 — The gate (auto_rollback_rule)
 */
import type { PromotionPolicy, PromotionReport, PromotionDecision } from '@lanefoundry/gatelane-sdk/promotion';
/** Canary deployment state. */
export type CanaryState = 'pending' | 'canary' | 'observing' | 'promoting' | 'promoted' | 'rolled_back' | 'failed';
/** Canary deployment record (persisted in D1). */
export type CanaryRecord = {
    /** Unique canary deployment ID. */
    id: string;
    /** Gate run ID that produced the promotion decision. */
    gateRunId: string;
    /** Winner candidate reference. */
    candidateRef: string;
    /** Current state. */
    state: CanaryState;
    /** Canary traffic percentage (0-100). */
    trafficPercent: number;
    /** When the canary was started. */
    startedAt: string;
    /** When the observation window ends (ISO 8601). */
    observationEndsAt?: string;
    /** When the canary was completed (promoted/rolled_back). */
    completedAt?: string;
    /** Auto-rollback rule from policy. */
    autoRollbackRule?: PromotionPolicy['auto_rollback_rule'];
    /** Metric observations during canary. */
    observations: CanaryObservation[];
    /** Error message if failed. */
    error?: string;
    /** The original PromotionReport. */
    report: PromotionReport;
    /** The original PromotionDecision. */
    decision: PromotionDecision;
};
/** Single metric observation during canary. */
export type CanaryObservation = {
    timestamp: string;
    /** Metric name (e.g., 'error_rate', 'latency_p99', 'cost_per_1k'). */
    metric: string;
    /** Current value. */
    value: number;
    /** Baseline value for comparison. */
    baseline: number;
    /** Delta from baseline (value - baseline) / baseline. */
    delta: number;
};
/** Arguments for starting a canary. */
export type StartCanaryArgs = {
    /** Gate run ID from the promotion report. */
    gateRunId: string;
    /** The winning candidate reference. */
    candidateRef: string;
    /** The signed PromotionReport. */
    report: PromotionReport;
    /** The PromotionDecision (must be 'promote'). */
    decision: PromotionDecision;
    /** Initial canary traffic percentage. Default: 10. */
    initialTrafficPercent?: number;
    /** Custom observation window. Default: from policy.auto_rollback_rule.window or "24h". */
    observationWindow?: string;
};
/** Result of canary operations. */
export type CanaryResult = {
    /** The canary record. */
    record: CanaryRecord;
    /** Whether the operation advanced the state. */
    advanced: boolean;
};
/** D1 storage interface for canary persistence. */
export interface CanaryStorage {
    /** Create a new canary record. */
    create(record: CanaryRecord): Promise<void>;
    /** Read a canary record by ID. */
    read(id: string): Promise<CanaryRecord | null>;
    /** Update an existing canary record. */
    update(record: CanaryRecord): Promise<void>;
    /** List canary records (optionally filtered by state). */
    list(filter?: {
        state?: CanaryState;
        limit?: number;
    }): Promise<ReadonlyArray<CanaryRecord>>;
}
/** In-memory storage for tests / local dev. */
export declare class InMemoryCanaryStorage implements CanaryStorage {
    #private;
    create(record: CanaryRecord): Promise<void>;
    read(id: string): Promise<CanaryRecord | null>;
    update(record: CanaryRecord): Promise<void>;
    list(filter?: {
        state?: CanaryState;
        limit?: number;
    }): Promise<ReadonlyArray<CanaryRecord>>;
}
/** Replace the active canary storage. Returns previous for test restoration. */
export declare function setCanaryStorage(storage: CanaryStorage): CanaryStorage;
/** Get the active canary storage. */
export declare function getCanaryStorage(): CanaryStorage;
/**
 * Start a new canary deployment.
 * Creates the record in 'canary' state with 10% traffic.
 */
export declare function startCanary(args: StartCanaryArgs): Promise<CanaryResult>;
/**
 * Record a metric observation for a canary.
 * Checks auto-rollback rule and transitions to rolled_back if triggered.
 */
export declare function recordObservation(canaryId: string, metric: string, value: number, baseline: number): Promise<CanaryResult>;
/**
 * Advance the canary state machine.
 * canary -> observing -> promoting -> promoted
 */
export declare function advanceCanary(canaryId: string): Promise<CanaryResult>;
/**
 * Manually rollback a canary.
 */
export declare function rollbackCanary(canaryId: string, reason: string): Promise<CanaryResult>;
/**
 * Mark a canary as failed (e.g., deployment error).
 */
export declare function failCanary(canaryId: string, error: string): Promise<CanaryResult>;
/**
 * Get all canaries that need observation window checks.
 * Useful for a cron job that periodically calls advanceCanary.
 */
export declare function getActiveCanaries(): Promise<ReadonlyArray<CanaryRecord>>;
/**
 * Check and advance all active canaries.
 * Returns records that changed state.
 */
export declare function tickCanaries(): Promise<ReadonlyArray<CanaryRecord>>;
/**
 * D1 storage implementation (for Cloudflare Workers).
 * Requires @cloudflare/workers-types and a D1 database binding.
 */
export declare class D1CanaryStorage implements CanaryStorage {
    private readonly db;
    constructor(db: any);
    create(record: CanaryRecord): Promise<void>;
    read(id: string): Promise<CanaryRecord | null>;
    update(record: CanaryRecord): Promise<void>;
    list(filter?: {
        state?: CanaryState;
        limit?: number;
    }): Promise<ReadonlyArray<CanaryRecord>>;
    private rowToRecord;
}
//# sourceMappingURL=canary-orchestrator.d.ts.map
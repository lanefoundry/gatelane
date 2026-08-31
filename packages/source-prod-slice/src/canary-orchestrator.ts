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
export type CanaryState =
  | 'pending'
  | 'canary'
  | 'observing'
  | 'promoting'
  | 'promoted'
  | 'rolled_back'
  | 'failed';

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
  list(filter?: { state?: CanaryState; limit?: number }): Promise<ReadonlyArray<CanaryRecord>>;
}

/** In-memory storage for tests / local dev. */
export class InMemoryCanaryStorage implements CanaryStorage {
  readonly #records = new Map<string, CanaryRecord>();

  async create(record: CanaryRecord): Promise<void> {
    this.#records.set(record.id, record);
  }

  async read(id: string): Promise<CanaryRecord | null> {
    return this.#records.get(id) ?? null;
  }

  async update(record: CanaryRecord): Promise<void> {
    this.#records.set(record.id, record);
  }

  async list(filter?: { state?: CanaryState; limit?: number }): Promise<ReadonlyArray<CanaryRecord>> {
    let out = Array.from(this.#records.values());
    if (filter?.state) {
      out = out.filter((r) => r.state === filter.state);
    }
    out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    if (filter?.limit) {
      out = out.slice(0, filter.limit);
    }
    return out;
  }
}

/** Active canary storage (singleton for simplicity). */
let activeCanaryStorage: CanaryStorage = new InMemoryCanaryStorage();

/** Replace the active canary storage. Returns previous for test restoration. */
export function setCanaryStorage(storage: CanaryStorage): CanaryStorage {
  const prev = activeCanaryStorage;
  activeCanaryStorage = storage;
  return prev;
}

/** Get the active canary storage. */
export function getCanaryStorage(): CanaryStorage {
  return activeCanaryStorage;
}

/** Parse a window string like "24h" into milliseconds. */
function parseWindow(window: string): number {
  const match = window.match(/^(\d+)([smhd])$/);
  if (!match || !match[1] || !match[2]) throw new Error(`Invalid window format: ${window} (expected e.g., "24h")`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit as keyof typeof multipliers];
}

/** Generate a canary ID. */
function generateCanaryId(): string {
  return `canary-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Start a new canary deployment.
 * Creates the record in 'canary' state with 10% traffic.
 */
export async function startCanary(args: StartCanaryArgs): Promise<CanaryResult> {
  const {
    gateRunId,
    candidateRef,
    report,
    decision,
    initialTrafficPercent = 10,
    observationWindow,
  } = args;

  if (decision.action !== 'promote') {
    throw new Error(`Cannot start canary: decision action is '${decision.action}', expected 'promote'`);
  }

  const autoRollbackRule = report.policy.auto_rollback_rule;
  const window = observationWindow ?? autoRollbackRule?.window ?? '24h';
  const windowMs = parseWindow(window);
  const now = new Date();
  const observationEndsAt = new Date(now.getTime() + windowMs).toISOString();

  const record: CanaryRecord = {
    id: generateCanaryId(),
    gateRunId,
    candidateRef,
    state: 'canary',
    trafficPercent: initialTrafficPercent,
    startedAt: now.toISOString(),
    observationEndsAt,
    autoRollbackRule,
    observations: [],
    report,
    decision,
  };

  await activeCanaryStorage.create(record);

  // Advance to observing state
  return advanceCanary(record.id);
}

/**
 * Record a metric observation for a canary.
 * Checks auto-rollback rule and transitions to rolled_back if triggered.
 */
export async function recordObservation(
  canaryId: string,
  metric: string,
  value: number,
  baseline: number,
): Promise<CanaryResult> {
  const record = await activeCanaryStorage.read(canaryId);
  if (!record) throw new Error(`Canary not found: ${canaryId}`);
  if (record.state !== 'observing' && record.state !== 'canary') {
    throw new Error(`Cannot record observation: canary in state '${record.state}'`);
  }

  const delta = baseline === 0 ? 0 : (value - baseline) / baseline;
  const observation: CanaryObservation = {
    timestamp: new Date().toISOString(),
    metric,
    value,
    baseline,
    delta,
  };

  record.observations.push(observation);

  // Check auto-rollback
  if (record.autoRollbackRule && delta <= -record.autoRollbackRule.metric_drop) {
    record.state = 'rolled_back';
    record.completedAt = new Date().toISOString();
    record.error = `Auto-rollback triggered: ${metric} delta ${delta.toFixed(2)} <= -${record.autoRollbackRule.metric_drop}`;
    await activeCanaryStorage.update(record);
    return { record, advanced: true };
  }

  await activeCanaryStorage.update(record);
  return { record, advanced: false };
}

/**
 * Advance the canary state machine.
 * canary -> observing -> promoting -> promoted
 */
export async function advanceCanary(canaryId: string): Promise<CanaryResult> {
  const record = await activeCanaryStorage.read(canaryId);
  if (!record) throw new Error(`Canary not found: ${canaryId}`);

  const now = new Date();

  switch (record.state) {
    case 'pending':
    case 'canary': {
      // Move to observing, set observation window
      record.state = 'observing';
      if (!record.observationEndsAt) {
        const window = record.autoRollbackRule?.window ?? '24h';
        record.observationEndsAt = new Date(now.getTime() + parseWindow(window)).toISOString();
      }
      break;
    }
    case 'observing': {
      // Check if observation window has elapsed
      const endsAt = record.observationEndsAt ? Date.parse(record.observationEndsAt) : 0;
      if (now.getTime() < endsAt) {
        return { record, advanced: false }; // Still observing
      }
      // Window elapsed, start promoting
      record.state = 'promoting';
      record.trafficPercent = 100;
      break;
    }
    case 'promoting': {
      // Promote to 100%
      record.state = 'promoted';
      record.trafficPercent = 100;
      record.completedAt = now.toISOString();
      break;
    }
    case 'promoted':
    case 'rolled_back':
    case 'failed': {
      // Terminal states - no advancement
      return { record, advanced: false };
    }
  }

  await activeCanaryStorage.update(record);
  return { record, advanced: true };
}

/**
 * Manually rollback a canary.
 */
export async function rollbackCanary(canaryId: string, reason: string): Promise<CanaryResult> {
  const record = await activeCanaryStorage.read(canaryId);
  if (!record) throw new Error(`Canary not found: ${canaryId}`);
  if (record.state === 'promoted' || record.state === 'rolled_back') {
    throw new Error(`Cannot rollback: canary already in terminal state '${record.state}'`);
  }

  record.state = 'rolled_back';
  record.completedAt = new Date().toISOString();
  record.error = `Manual rollback: ${reason}`;
  record.trafficPercent = 0;

  await activeCanaryStorage.update(record);
  return { record, advanced: true };
}

/**
 * Mark a canary as failed (e.g., deployment error).
 */
export async function failCanary(canaryId: string, error: string): Promise<CanaryResult> {
  const record = await activeCanaryStorage.read(canaryId);
  if (!record) throw new Error(`Canary not found: ${canaryId}`);

  record.state = 'failed';
  record.completedAt = new Date().toISOString();
  record.error = error;

  await activeCanaryStorage.update(record);
  return { record, advanced: true };
}

/**
 * Get all canaries that need observation window checks.
 * Useful for a cron job that periodically calls advanceCanary.
 */
export async function getActiveCanaries(): Promise<ReadonlyArray<CanaryRecord>> {
  return activeCanaryStorage.list({ state: 'observing' });
}

/**
 * Check and advance all active canaries.
 * Returns records that changed state.
 */
export async function tickCanaries(): Promise<ReadonlyArray<CanaryRecord>> {
  const active = await getActiveCanaries();
  const changed: CanaryRecord[] = [];

  for (const record of active) {
    const result = await advanceCanary(record.id);
    if (result.advanced) {
      changed.push(result.record);
    }
  }

  return changed;
}

/**
 * D1 storage implementation (for Cloudflare Workers).
 * Requires @cloudflare/workers-types and a D1 database binding.
 */
export class D1CanaryStorage implements CanaryStorage {
  constructor(private readonly db: any /* D1Database */) {}

  async create(record: CanaryRecord): Promise<void> {
    await this.db.prepare(
      `INSERT INTO canary_deployments (id, gate_run_id, candidate_ref, state, traffic_percent, started_at, observation_ends_at, auto_rollback_rule, observations, report, decision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      record.id,
      record.gateRunId,
      record.candidateRef,
      record.state,
      record.trafficPercent,
      record.startedAt,
      record.observationEndsAt ?? null,
      record.autoRollbackRule ? JSON.stringify(record.autoRollbackRule) : null,
      JSON.stringify(record.observations),
      JSON.stringify(record.report),
      JSON.stringify(record.decision),
    ).run();
  }

  async read(id: string): Promise<CanaryRecord | null> {
    const row = await this.db.prepare('SELECT * FROM canary_deployments WHERE id = ?').bind(id).first();
    if (!row) return null;
    return this.rowToRecord(row);
  }

  async update(record: CanaryRecord): Promise<void> {
    await this.db.prepare(
      `UPDATE canary_deployments SET
         state = ?, traffic_percent = ?, observation_ends_at = ?, completed_at = ?, error = ?,
         observations = ?, report = ?, decision = ?
       WHERE id = ?`
    ).bind(
      record.state,
      record.trafficPercent,
      record.observationEndsAt ?? null,
      record.completedAt ?? null,
      record.error ?? null,
      JSON.stringify(record.observations),
      JSON.stringify(record.report),
      JSON.stringify(record.decision),
      record.id,
    ).run();
  }

  async list(filter?: { state?: CanaryState; limit?: number }): Promise<ReadonlyArray<CanaryRecord>> {
    let sql = 'SELECT * FROM canary_deployments';
    const params: unknown[] = [];
    if (filter?.state) {
      sql += ' WHERE state = ?';
      params.push(filter.state);
    }
    sql += ' ORDER BY started_at DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    const { results } = await this.db.prepare(sql).bind(...params).all();
    return (results ?? []).map((row: any) => this.rowToRecord(row));
  }

  private rowToRecord(row: any): CanaryRecord {
    return {
      id: row.id,
      gateRunId: row.gate_run_id,
      candidateRef: row.candidate_ref,
      state: row.state,
      trafficPercent: row.traffic_percent,
      startedAt: row.started_at,
      observationEndsAt: row.observation_ends_at,
      completedAt: row.completed_at,
      autoRollbackRule: row.auto_rollback_rule ? JSON.parse(row.auto_rollback_rule) : undefined,
      observations: JSON.parse(row.observations),
      error: row.error,
      report: JSON.parse(row.report),
      decision: JSON.parse(row.decision),
    };
  }
}
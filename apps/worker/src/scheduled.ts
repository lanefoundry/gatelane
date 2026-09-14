/**
 * Scheduled handler — runs on a cron trigger to:
 * 1. Tick canaries: advance any observing canary whose window has elapsed.
 * 2. Auto-observe: collect metrics from recent captures and feed them into active canaries.
 * 3. Audit: log every state transition and auto-rollback.
 */
import type { Env } from "./types.js";

interface CanaryRow {
  id: string;
  gate_run_id: string;
  candidate_ref: string;
  state: string;
  traffic_percent: number;
  started_at: string;
  observation_ends_at: string | null;
  completed_at: string | null;
  auto_rollback_rule: string | null;
  observations: string;
  error: string | null;
  report: string;
  decision: string;
}

interface CaptureAgg {
  total: number;
  totalLatencyMs: number;
  totalCostCents: number;
  errors: number;
}

/**
 * Collect aggregate metrics from captures in a time window for a given model.
 */
async function collectMetrics(
  db: D1Database,
  model: string,
  since: string,
): Promise<CaptureAgg | null> {
  const row = await db.prepare(
    `SELECT
       COUNT(*) as total,
       COALESCE(SUM(latency_ms), 0) as total_latency_ms,
       COALESCE(SUM(cost_cents), 0) as total_cost_cents,
       COALESCE(SUM(CASE WHEN latency_ms > 30000 THEN 1 ELSE 0 END), 0) as errors
     FROM captures
     WHERE model = ? AND created_at >= ?`,
  ).bind(model, since).first() as Record<string, number> | null;
  if (!row || row.total === 0) return null;
  return {
    total: row.total,
    totalLatencyMs: row.total_latency_ms,
    totalCostCents: row.total_cost_cents,
    errors: row.errors,
  };
}

/**
 * Record an observation for a canary: append to observations JSON, check auto-rollback.
 */
async function recordObservation(
  db: D1Database,
  canary: CanaryRow,
  metric: string,
  value: number,
  baseline: number,
): Promise<{ rolledBack: boolean; error?: string }> {
  const delta = baseline === 0 ? 0 : (value - baseline) / baseline;
  const observations = JSON.parse(canary.observations || "[]") as unknown[];
  observations.push({
    timestamp: new Date().toISOString(),
    metric,
    value,
    baseline,
    delta,
  });

  const autoRollbackRule = canary.auto_rollback_rule
    ? JSON.parse(canary.auto_rollback_rule) as { metric_drop?: number }
    : null;

  if (autoRollbackRule?.metric_drop !== undefined && delta <= -autoRollbackRule.metric_drop) {
    const errorMsg = `Auto-rollback: ${metric} delta ${delta.toFixed(3)} <= -${autoRollbackRule.metric_drop}`;
    await db.prepare(
      `UPDATE canary_deployments
       SET observations = ?, state = 'rolled_back', error = ?, completed_at = ?, traffic_percent = 0
       WHERE id = ?`,
    ).bind(
      JSON.stringify(observations),
      errorMsg,
      new Date().toISOString(),
      canary.id,
    ).run();
    return { rolledBack: true, error: errorMsg };
  }

  await db.prepare(
    `UPDATE canary_deployments SET observations = ? WHERE id = ?`,
  ).bind(JSON.stringify(observations), canary.id).run();
  return { rolledBack: false };
}

/**
 * Tick: advance canaries whose observation window has elapsed.
 */
async function tickCanaries(db: D1Database): Promise<{ advanced: string[]; promoted: string[] }> {
  const { results } = await db.prepare(
    `SELECT * FROM canary_deployments WHERE state = 'observing'`,
  ).all();

  const now = Date.now();
  const advanced: string[] = [];
  const promoted: string[] = [];

  for (const row of results as unknown as CanaryRow[]) {
    const endsAt = row.observation_ends_at ? Date.parse(row.observation_ends_at) : 0;
    if (now < endsAt) continue;

    // observing → promoting
    await db.prepare(
      `UPDATE canary_deployments SET state = 'promoting', traffic_percent = 100 WHERE id = ?`,
    ).bind(row.id).run();
    advanced.push(row.id);
  }

  // Also advance promoting → promoted
  const { results: promoting } = await db.prepare(
    `SELECT * FROM canary_deployments WHERE state = 'promoting'`,
  ).all();

  for (const row of promoting as unknown as CanaryRow[]) {
    await db.prepare(
      `UPDATE canary_deployments SET state = 'promoted', completed_at = ? WHERE id = ?`,
    ).bind(new Date().toISOString(), row.id).run();
    promoted.push(row.id);
  }

  return { advanced, promoted };
}

/**
 * Auto-observe: for each active canary, collect metrics from recent captures
 * and record observations.
 */
async function autoObserve(db: D1Database): Promise<{ observed: string[]; rolledBack: string[] }> {
  const { results } = await db.prepare(
    `SELECT * FROM canary_deployments WHERE state IN ('observing', 'canary')`,
  ).all();

  const observed: string[] = [];
  const rolledBack: string[] = [];
  const since = new Date(Date.now() - 5 * 60_000).toISOString(); // last 5 minutes

  for (const row of results as unknown as CanaryRow[]) {
    const report = JSON.parse(row.report || "{}") as Record<string, unknown>;
    const baselineMetrics = (report.baseline_metrics ?? {}) as Record<string, number>;

    const metrics = await collectMetrics(db, row.candidate_ref, since);
    if (!metrics || metrics.total === 0) continue;

    // Observe: error rate
    const errorRate = metrics.errors / metrics.total;
    const baselineErrorRate = baselineMetrics.error_rate ?? 0.02;
    const errResult = await recordObservation(db, row, "error_rate", errorRate, baselineErrorRate);
    if (errResult.rolledBack) { rolledBack.push(row.id); continue; }

    // Observe: avg latency
    const avgLatency = metrics.totalLatencyMs / metrics.total;
    const baselineLatency = baselineMetrics.latency ?? baselineMetrics.mean_latency_ms ?? 500;
    const latResult = await recordObservation(db, row, "avg_latency_ms", avgLatency, baselineLatency);
    if (latResult.rolledBack) { rolledBack.push(row.id); continue; }

    // Observe: avg cost
    const avgCost = metrics.totalCostCents / metrics.total;
    const baselineCost = baselineMetrics.cost ?? baselineMetrics.cost_per_1k ?? 1;
    const costResult = await recordObservation(db, row, "avg_cost_cents", avgCost, baselineCost);
    if (costResult.rolledBack) { rolledBack.push(row.id); continue; }

    observed.push(row.id);
  }

  return { observed, rolledBack };
}

/**
 * Write audit log entries for state transitions.
 */
async function auditStateTransitions(
  db: D1Database,
  transitions: Array<{ canaryId: string; action: string; detail: string }>,
): Promise<void> {
  for (const t of transitions) {
    await db.prepare(
      `INSERT INTO audit_log (id, action, resource_type, resource_id, actor, detail, created_at)
       VALUES (?, ?, 'canary', ?, 'scheduled', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      t.action,
      t.canaryId,
      JSON.stringify({ action: t.action, detail: t.detail }),
      new Date().toISOString(),
    ).run();
  }
}

/**
 * Main scheduled handler — called by Cloudflare cron trigger.
 */
export async function scheduled(env: Env): Promise<void> {
  const db = env.DB;
  const auditEntries: Array<{ canaryId: string; action: string; detail: string }> = [];

  // 1. Auto-observe: collect production metrics for active canaries
  const { observed, rolledBack } = await autoObserve(db);
  for (const id of rolledBack) {
    auditEntries.push({ canaryId: id, action: "auto_rollback", detail: "Metric threshold exceeded during scheduled observation" });
  }

  // 2. Tick: advance canaries whose observation window elapsed
  const { advanced, promoted } = await tickCanaries(db);
  for (const id of advanced) {
    auditEntries.push({ canaryId: id, action: "advance", detail: "Observation window elapsed → promoting" });
  }
  for (const id of promoted) {
    auditEntries.push({ canaryId: id, action: "promote", detail: "Promotion complete → 100% traffic" });
  }

  // 3. Audit log
  if (auditEntries.length > 0) {
    await auditStateTransitions(db, auditEntries);
  }

  // Log summary (visible in Workers Logs)
  console.log(`[gatelane scheduled] observed=${observed.length} rolledBack=${rolledBack.length} advanced=${advanced.length} promoted=${promoted.length}`);
}

import type { Env } from "@gatelane/shared";
import { writeAuditLog } from "@gatelane/engine";
import type { AnomalyRule, Anomaly, AnomalyReport } from "./types.js";

/** Map user-facing metric names to captures table columns. */
const METRIC_COLUMN: Record<string, string> = {
  cost_cents: "cost_cents",
  cost: "cost_cents",
  latency_ms: "latency_ms",
  latency: "latency_ms",
};

/**
 * Scan recent production data for anomalies.
 *
 * For each enabled rule the function compares the average metric value in the
 * current window against the immediately preceding window of the same length.
 * When the percentage change exceeds the rule's threshold an {@link Anomaly}
 * is emitted and an audit-log entry is written.
 */
export async function detect(
  env: Env,
  rules: AnomalyRule[],
): Promise<AnomalyReport> {
  const now = new Date();
  const reportId = crypto.randomUUID();

  const enabledRules = rules.filter((r) => r.enabled);

  // Determine the widest window across all rules so we can report a single
  // overall scan range.  Individual rules may use narrower windows.
  let widestMs = 0;
  for (const rule of enabledRules) {
    const ms = parseWindow(rule.windowSize);
    if (ms > widestMs) widestMs = ms;
  }

  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - (widestMs || 0)).toISOString();

  const anomalies: Anomaly[] = [];

  for (const rule of enabledRules) {
    const anomaly = await evaluateRule(env, rule, now);
    if (anomaly) {
      anomalies.push(anomaly);
    }
  }

  const report: AnomalyReport = {
    id: reportId,
    rules,
    anomalies,
    scannedAt: now.toISOString(),
    windowStart,
    windowEnd,
    status: anomalies.length > 0 ? "anomalies-detected" : "clean",
  };

  await writeAuditLog(env, {
    action: "anomaly",
    resourceType: "anomaly_report",
    resourceId: reportId,
    actor: "system",
    detail: {
      rulesEvaluated: enabledRules.length,
      anomaliesFound: anomalies.length,
      status: report.status,
    },
  });

  return report;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function evaluateRule(
  env: Env,
  rule: AnomalyRule,
  now: Date,
): Promise<Anomaly | null> {
  const column = METRIC_COLUMN[rule.metric];
  if (!column) {
    // Unknown metric — skip silently so callers can extend without breaking.
    return null;
  }

  const windowMs = parseWindow(rule.windowSize);

  // Current window:  [now - windowMs, now]
  const currentEnd = now.toISOString();
  const currentStart = new Date(now.getTime() - windowMs).toISOString();

  // Baseline window: [now - 2*windowMs, now - windowMs]
  const baselineEnd = currentStart;
  const baselineStart = new Date(now.getTime() - 2 * windowMs).toISOString();

  const [baselineAvg, currentAvg] = await Promise.all([
    queryAvg(env, column, baselineStart, baselineEnd),
    queryAvg(env, column, currentStart, currentEnd),
  ]);

  // If either window has no data we cannot compute a meaningful delta.
  if (baselineAvg === null || currentAvg === null) return null;
  // Avoid division by zero when the baseline value is 0.
  if (baselineAvg === 0) return null;

  const delta = ((currentAvg - baselineAvg) / Math.abs(baselineAvg)) * 100;

  if (Math.abs(delta) < rule.threshold) return null;

  const anomaly: Anomaly = {
    id: crypto.randomUUID(),
    ruleId: rule.id,
    type: rule.type,
    metric: rule.metric,
    baselineValue: baselineAvg,
    currentValue: currentAvg,
    delta,
    severity: deriveSeverity(Math.abs(delta), rule.threshold),
    detectedAt: now.toISOString(),
    windowStart: currentStart,
    windowEnd: currentEnd,
    metadata: {
      baselineWindowStart: baselineStart,
      baselineWindowEnd: baselineEnd,
    },
  };

  await writeAuditLog(env, {
    action: "anomaly",
    resourceType: "anomaly",
    resourceId: anomaly.id,
    actor: "system",
    detail: {
      ruleId: rule.id,
      ruleName: rule.name,
      metric: rule.metric,
      delta: anomaly.delta,
      severity: anomaly.severity,
    },
  });

  return anomaly;
}

async function queryAvg(
  env: Env,
  column: string,
  start: string,
  end: string,
): Promise<number | null> {
  // column is always one of our own constant strings (METRIC_COLUMN values),
  // never user-supplied, so interpolation is safe here.
  const result = await env.DB.prepare(
    `SELECT AVG(${column}) AS avg_val
       FROM captures
      WHERE created_at >= ?
        AND created_at < ?`,
  )
    .bind(start, end)
    .first<{ avg_val: number | null }>();

  return result?.avg_val ?? null;
}

function deriveSeverity(
  absDelta: number,
  threshold: number,
): Anomaly["severity"] {
  if (absDelta >= threshold * 10) return "critical";
  if (absDelta >= threshold * 5) return "high";
  if (absDelta >= threshold * 2) return "medium";
  return "low";
}

function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid window format: ${window}. Use e.g. "7d", "24h", "30m"`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}

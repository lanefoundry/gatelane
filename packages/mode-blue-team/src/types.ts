export type AnomalyType = "quality-degradation" | "behavioral-drift" | "cost-spike" | "latency-increase";

export interface AnomalyRule {
  id: string;
  name: string;
  type: AnomalyType;
  metric: string;          // which metric to watch (e.g., "cost_cents", "latency_ms")
  threshold: number;       // percentage change that triggers alert
  windowSize: string;      // time window to compare (e.g., "1h", "24h", "7d")
  enabled: boolean;
}

export interface Anomaly {
  id: string;
  ruleId: string;
  type: AnomalyType;
  metric: string;
  baselineValue: number;
  currentValue: number;
  delta: number;           // percentage change
  severity: "low" | "medium" | "high" | "critical";
  detectedAt: string;
  windowStart: string;
  windowEnd: string;
  metadata?: Record<string, unknown>;
}

export interface AnomalyReport {
  id: string;
  rules: AnomalyRule[];
  anomalies: Anomaly[];
  scannedAt: string;
  windowStart: string;
  windowEnd: string;
  status: "clean" | "anomalies-detected";
}

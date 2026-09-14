-- Base schema for gatelane D1 database.
-- Tables match the column names used by replay-api.ts and capture-endpoint.ts.

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  prompt TEXT NOT NULL,
  response TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  cost_cents REAL NOT NULL DEFAULT 0,
  latency_ms REAL NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);
CREATE INDEX IF NOT EXISTS idx_captures_model ON captures(model);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT 'prod',
  source_ref TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT,
  window_end TEXT,
  frozen_at TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS replay_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  candidate_model TEXT NOT NULL,
  baseline_model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (dataset_id) REFERENCES datasets(id)
);
CREATE INDEX IF NOT EXISTS idx_replay_runs_status ON replay_runs(status);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  gate_run_id TEXT NOT NULL,
  replay_run_id TEXT,
  delta REAL NOT NULL DEFAULT 0,
  threshold REAL NOT NULL DEFAULT 0.02,
  decision TEXT NOT NULL DEFAULT 'block',
  candidate_model TEXT NOT NULL,
  baseline_model TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '{}',
  report TEXT NOT NULL DEFAULT '{}',
  signature TEXT NOT NULL DEFAULT '',
  approver TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '{}',
  gate_run_id TEXT,
  event_type TEXT,
  payload_hash TEXT,
  signature TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_gate_run ON audit_log(gate_run_id);

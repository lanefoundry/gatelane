-- gatelane D1 schema
-- All timestamps are ISO 8601 UTC strings

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  prompt TEXT NOT NULL,          -- JSON array of ChatMessage
  response TEXT NOT NULL,        -- JSON (provider-specific)
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  cost_cents REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}', -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_captures_trace_id ON captures(trace_id);
CREATE INDEX IF NOT EXISTS idx_captures_model ON captures(model);
CREATE INDEX IF NOT EXISTS idx_captures_created_at ON captures(created_at);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frozen_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dataset_items (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  capture_id TEXT NOT NULL REFERENCES captures(id),
  ordinal INTEGER NOT NULL,
  UNIQUE(dataset_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_id ON dataset_items(dataset_id);

CREATE TABLE IF NOT EXISTS replay_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  candidate_model TEXT NOT NULL,
  baseline_model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_replay_runs_dataset_id ON replay_runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_replay_runs_status ON replay_runs(status);

CREATE TABLE IF NOT EXISTS replay_results (
  id TEXT PRIMARY KEY,
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id),
  dataset_item_id TEXT NOT NULL REFERENCES dataset_items(id),
  candidate_response TEXT NOT NULL,  -- JSON
  baseline_response TEXT NOT NULL,   -- JSON
  candidate_score REAL NOT NULL,
  baseline_score REAL NOT NULL,
  candidate_cost_cents REAL NOT NULL DEFAULT 0,
  candidate_latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_replay_results_run_id ON replay_results(replay_run_id);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  replay_run_id TEXT NOT NULL REFERENCES replay_runs(id),
  delta REAL NOT NULL,
  threshold REAL NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('promote', 'rollback')),
  candidate_model TEXT NOT NULL,
  baseline_model TEXT NOT NULL,
  summary TEXT NOT NULL,     -- JSON PromotionSummary
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_promotions_replay_run_id ON promotions(replay_run_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('capture', 'freeze', 'replay', 'promote', 'rollback')),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '{}', -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

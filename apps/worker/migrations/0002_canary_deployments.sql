-- Canary deployment state machine persistence.
-- States: pending → canary → observing → promoting → promoted | rolled_back | failed

CREATE TABLE IF NOT EXISTS canary_deployments (
  id TEXT PRIMARY KEY,
  gate_run_id TEXT NOT NULL,
  candidate_ref TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  traffic_percent INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  observation_ends_at TEXT,
  completed_at TEXT,
  auto_rollback_rule TEXT,
  observations TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  report TEXT NOT NULL,
  decision TEXT NOT NULL
);
CREATE INDEX idx_canary_state ON canary_deployments(state);
CREATE INDEX idx_canary_gate_run ON canary_deployments(gate_run_id);

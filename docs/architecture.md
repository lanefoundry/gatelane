# Gatelane Architecture

Pre-production safety and evaluation gate for AI agents. Gatelane captures
live LLM traffic, freezes it into reproducible datasets, replays those
datasets against candidate models, scores the results with an LLM judge,
and auto-promotes or rolls back based on a configurable quality threshold.

---

## 1. High-Level Overview

Gatelane is a monorepo organized around a **shared engine** that powers two
independent operating modes:

- **Blue team (藍隊) — Backtest** (`packages/mode-blue-team`): Takes a time window of
  production captures, freezes them into a dataset, replays the dataset
  against a candidate model, and produces a promote/rollback decision.
  Designed for scheduled or on-demand model upgrades.

- **Red team (紅隊)** (`packages/mode-red-team`): Runs adversarial
  attack vectors (prompt injection, tool abuse, context flooding, etc.)
  against a target and produces a vulnerability report. Designed for
  pre-deployment security validation.

Both modes import primitives from the engine and share the same type
definitions and storage bindings. The worker application exposes the
capture and query API and can orchestrate either mode.

```
                      +---------------------+
                      |    apps/worker      |
                      |  (Hono on CF Workers)|
                      +---------+-----------+
                                |
                  +-------------+-------------+
                  |                           |
        +---------+---------+       +---------+---------+
        | packages/         |       | packages/         |
        | mode-blue-team    |       | mode-red-team     |
        +--------+----------+       +--------+----------+
                 |                           |
                 +----------+----------------+
                            |
                  +---------+---------+
                  | packages/engine   |
                  | capture, replay,  |
                  | compare, promote, |
                  | dataset, audit    |
                  +--------+----------+
                           |
                  +--------+----------+
                  | packages/shared   |
                  | types, D1 schema  |
                  +-------------------+
```

---

## 2. Package Structure and Dependency Graph

The monorepo uses pnpm workspaces. Dependencies flow strictly upward:

```
packages/shared          (zero deps)
    ^
    |
packages/engine          (depends on shared)
    ^
    |
packages/mode-blue-team  (depends on shared + engine)
packages/mode-red-team   (depends on shared + engine)
    ^
    |
apps/worker              (depends on shared + engine + hono)
```

### Package inventory

| Package                  | npm name               | Purpose                                               |
|--------------------------|------------------------|-------------------------------------------------------|
| `packages/shared`        | `@gatelane/shared`     | TypeScript interfaces, D1 SQL schema, `Env` binding   |
| `packages/engine`        | `@gatelane/engine`     | Core primitives: capture, dataset, replay, compare, promotion, audit log |
| `packages/mode-blue-team` | `@gatelane/mode-blue-team` | Orchestrates freeze-replay-promote in one call      |
| `packages/mode-red-team` | `@gatelane/mode-red-team` | Adversarial attack vectors and reporting types       |
| `apps/worker`            | `@gatelane/worker`     | Cloudflare Worker; Hono HTTP server                   |

### Engine exports

The engine (`packages/engine/src/index.ts`) surfaces six public functions:

| Export               | Module          | Role                                          |
|----------------------|-----------------|-----------------------------------------------|
| `capture`            | `capture.ts`    | Execute an LLM call and record the result     |
| `createDataset`      | `dataset.ts`    | Build a dataset from an explicit list of capture IDs |
| `freezeSlice`        | `dataset.ts`    | Build a dataset from a time-window query      |
| `replay`             | `replay.ts`     | Re-run a dataset against candidate + baseline |
| `compare`            | `compare.ts`    | Aggregate replay results into a summary       |
| `evaluatePromotion`  | `promotion.ts`  | Compare + threshold check = promote/rollback  |
| `writeAuditLog`      | `audit-log.ts`  | Append an entry to the audit log              |

---

## 3. Data Flow

The core pipeline is a five-stage chain. Each stage produces a durable
artifact stored in D1 (and optionally R2) before the next stage begins.

```
   (1) Capture           (2) Freeze            (3) Replay
 +-------------+     +-------------+     +------------------+
 | LLM call    |---->| Dataset     |---->| ReplayRun        |
 | recorded    |     | frozen from |     | candidate vs.    |
 | to D1 + R2  |     | time window |     | baseline, scored |
 +-------------+     +-------------+     +------------------+
                                                  |
                          (4) Compare             v
                      +------------------+   +-------------+
                      | PromotionSummary |<--| ReplayResult|
                      | avg scores, cost,|   | per-item    |
                      | latency, regress.|   | scores      |
                      +--------+---------+   +-------------+
                               |
                          (5) Promote
                      +--------v---------+
                      | PromotionReport  |
                      | delta >= thresh? |
                      | "promote" or     |
                      | "rollback"       |
                      +------------------+
```

### Stage details

1. **Capture** -- The caller sends a prompt and the provider's response to
   `POST /v1/capture`. The engine records a `CaptureRecord` row in D1
   (structured metadata) and writes the full JSON blob to R2
   (`captures/{id}.json`). Latency is measured around the execute callback.
   Provider is auto-inferred from model prefix when not supplied.

2. **Freeze (Dataset creation)** -- `freezeSlice` queries D1 for all
   captures within a `[windowStart, windowEnd]` range, creates a `Dataset`
   row, and inserts ordered `DatasetItem` rows pointing back to the
   original captures. The dataset is immutable once frozen. Alternatively,
   `createDataset` accepts an explicit list of capture IDs.

3. **Replay** -- For each item in the dataset, the engine sends the
   original prompt to the candidate model via the caller-provided `execute`
   callback, then scores both the candidate response and the stored
   baseline response with the caller-provided `judge` callback. Each pair
   produces a `ReplayResult` row (scores, cost, latency). The run is
   marked `completed` or `failed`.

4. **Compare** -- Aggregates all `ReplayResult` rows for a run into a
   `PromotionSummary`: average scores, average cost and latency for both
   candidate and baseline, and a regression count (items where the
   candidate scored lower).

5. **Promote** -- Computes `delta = candidateAvgScore - baselineAvgScore`.
   If `delta >= threshold`, the decision is `"promote"`; otherwise
   `"rollback"`. The result is persisted as a signed `PromotionReport` in
   D1. The signature is a SHA-256 hash of `id:delta:decision`.

Every stage writes to the audit log via `writeAuditLog`.

---

## 4. Storage Layer

Gatelane uses three Cloudflare storage services, bound through the `Env`
interface:

```
+---------------------------------------------+
|  Env bindings (wrangler.toml)               |
|                                             |
|  DB: D1Database         -- structured data  |
|  CAPTURES: R2Bucket     -- raw blobs        |
|  GATELANE_KV: KVNamespace -- ephemeral keys |
+---------------------------------------------+
```

### D1 (Cloudflare D1 -- SQLite)

Primary store for all structured metadata: captures, datasets, dataset
items, replay runs, replay results, promotions, and audit log. All
timestamps are ISO 8601 UTC strings. See Section 6 for the full schema.

### R2 (Cloudflare R2 -- Object Storage)

Stores the full JSON payload of each capture at the key
`captures/{id}.json`. This keeps the D1 row compact (it also stores the
prompt and response inline for query convenience) while providing durable
blob storage for large payloads.

### KV (Cloudflare Workers KV)

Bound as `GATELANE_KV`. Reserved for rate-limiting and short-window
operational state (e.g., deduplication keys, token budget tracking). Not
used for durable business data.

### Secret bindings

| Variable                   | Purpose                              |
|----------------------------|--------------------------------------|
| `GATELANE_CAPTURE_TOKEN`   | Bearer token for the capture endpoint |
| `GATELANE_JUDGE_PROVIDER`  | Provider of the judge model          |
| `GATELANE_JUDGE_API_KEY`   | API key for the judge model          |
| `GATELANE_JUDGE_MODEL`     | Model ID used to score responses     |

Secrets are deployed via `wrangler secret bulk .env`.

---

## 5. Worker API Endpoints

The worker (`apps/worker`) uses the Hono framework. All API routes are
prefixed with `/v1`.

### System

| Method | Path      | Description          |
|--------|-----------|----------------------|
| GET    | `/`       | Service info + status |
| GET    | `/health` | Health check          |

### Capture

| Method | Path          | Auth            | Description                                  |
|--------|---------------|-----------------|----------------------------------------------|
| POST   | `/v1/capture` | Bearer token    | Record a prompt/response pair. Returns `{id, traceId}` with status 201. |

Request body:
```json
{
  "prompt": [{"role": "user", "content": "..."}],
  "model": "gpt-4o",
  "provider": "openai",
  "response": { ... },
  "metadata": {"traceId": "abc-123"}
}
```

### Query (read-only)

| Method | Path                  | Description                         |
|--------|-----------------------|-------------------------------------|
| GET    | `/v1/datasets`        | List datasets (most recent 50)      |
| GET    | `/v1/datasets/:id`    | Get single dataset                  |
| GET    | `/v1/replay-runs`     | List replay runs (most recent 50)   |
| GET    | `/v1/replay-runs/:id` | Get single replay run               |
| GET    | `/v1/promotions`      | List promotions (most recent 50)    |
| GET    | `/v1/promotions/:id`  | Get single promotion                |
| GET    | `/v1/audit-log`       | List audit entries (most recent 100)|

All query endpoints return JSON. No authentication is currently enforced
on read endpoints.

---

## 6. D1 Schema Overview

Six tables, with foreign keys enforcing referential integrity.

```
captures
  |
  +--< dataset_items >--+ datasets
                         |
                         +--< replay_runs
                                  |
                                  +--< replay_results
                                  |
                                  +--< promotions

audit_log (standalone)
```

### Table: `captures`

Primary record of an LLM interaction.

| Column       | Type    | Notes                           |
|--------------|---------|---------------------------------|
| id           | TEXT PK | UUID                            |
| trace_id     | TEXT    | Correlation ID across calls     |
| prompt       | TEXT    | JSON array of ChatMessage       |
| response     | TEXT    | JSON, provider-specific shape   |
| model        | TEXT    | e.g. "gpt-4o", "claude-3.5-sonnet" |
| provider     | TEXT    | "openai", "anthropic", "google" |
| cost_cents   | REAL    | Cost in cents                   |
| latency_ms   | INTEGER | End-to-end latency              |
| metadata     | TEXT    | JSON bag for caller context     |
| created_at   | TEXT    | ISO 8601 UTC                    |

Indexes: `trace_id`, `model`, `created_at`.

### Table: `datasets`

An immutable snapshot of captures for evaluation.

| Column       | Type    | Notes                              |
|--------------|---------|------------------------------------||
| id           | TEXT PK | UUID                               |
| name         | TEXT    | Human-readable label               |
| description  | TEXT    | Optional                           |
| frozen_at    | TEXT    | When the snapshot was taken         |
| window_start | TEXT    | Earliest capture timestamp included |
| window_end   | TEXT    | Latest capture timestamp included   |
| item_count   | INTEGER | Number of items                    |
| created_at   | TEXT    | ISO 8601 UTC                       |

### Table: `dataset_items`

Join table linking a dataset to its captures, with ordering.

| Column     | Type    | Notes                              |
|------------|---------|------------------------------------||
| id         | TEXT PK | UUID                               |
| dataset_id | TEXT FK | References `datasets.id`           |
| capture_id | TEXT FK | References `captures.id`           |
| ordinal    | INTEGER | Position in the dataset            |

Unique constraint on `(dataset_id, ordinal)`.

### Table: `replay_runs`

A single evaluation run comparing two models over a dataset.

| Column          | Type    | Notes                              |
|-----------------|---------|------------------------------------||
| id              | TEXT PK | UUID                               |
| dataset_id      | TEXT FK | References `datasets.id`           |
| candidate_model | TEXT    | Model being evaluated              |
| baseline_model  | TEXT    | Reference model                    |
| status          | TEXT    | pending / running / completed / failed |
| started_at      | TEXT    | Nullable                           |
| completed_at    | TEXT    | Nullable                           |
| created_at      | TEXT    | ISO 8601 UTC                       |

Indexes: `dataset_id`, `status`.

### Table: `replay_results`

Per-item outcome of a replay run.

| Column              | Type    | Notes                          |
|---------------------|---------|--------------------------------|
| id                  | TEXT PK | UUID                           |
| replay_run_id       | TEXT FK | References `replay_runs.id`    |
| dataset_item_id     | TEXT FK | References `dataset_items.id`  |
| candidate_response  | TEXT    | JSON                           |
| baseline_response   | TEXT    | JSON                           |
| candidate_score     | REAL    | Judge score for candidate      |
| baseline_score      | REAL    | Judge score for baseline       |
| candidate_cost_cents| REAL    | Cost of candidate call         |
| candidate_latency_ms| INTEGER | Latency of candidate call      |
| created_at          | TEXT    | ISO 8601 UTC                   |

Index: `replay_run_id`.

### Table: `promotions`

The final decision record for a replay run.

| Column          | Type    | Notes                              |
|-----------------|---------|------------------------------------||
| id              | TEXT PK | UUID                               |
| replay_run_id   | TEXT FK | References `replay_runs.id`        |
| delta           | REAL    | candidateAvgScore - baselineAvgScore |
| threshold       | REAL    | Minimum delta for promotion        |
| decision        | TEXT    | "promote" or "rollback"            |
| candidate_model | TEXT    | Model being evaluated              |
| baseline_model  | TEXT    | Reference model                    |
| summary         | TEXT    | JSON PromotionSummary              |
| signature       | TEXT    | SHA-256 hash for tamper detection  |
| created_at      | TEXT    | ISO 8601 UTC                       |

Index: `replay_run_id`.

### Table: `audit_log`

Append-only record of every significant action.

| Column        | Type    | Notes                                     |
|---------------|---------|-------------------------------------------|
| id            | TEXT PK | UUID                                      |
| action        | TEXT    | capture / freeze / replay / promote / rollback |
| resource_type | TEXT    | e.g. "capture", "dataset", "promotion"    |
| resource_id   | TEXT    | UUID of the affected resource             |
| actor         | TEXT    | "api", "system", or user identifier       |
| detail        | TEXT    | JSON with action-specific context         |
| created_at    | TEXT    | ISO 8601 UTC                              |

Indexes: `action`, `(resource_type, resource_id)`, `created_at`.

---

## 7. Promotion Primitive

The promotion system is the decision gate at the end of every evaluation.

### Algorithm

```
  candidateAvgScore = mean(candidate_score for all items)
  baselineAvgScore  = mean(baseline_score  for all items)
  delta             = candidateAvgScore - baselineAvgScore

  if delta >= threshold:
      decision = "promote"
  else:
      decision = "rollback"
```

### What the summary captures

The `PromotionSummary` aggregated by `compare()` includes:

- `totalItems` -- number of dataset items evaluated
- `candidateAvgScore` / `baselineAvgScore` -- quality comparison
- `candidateAvgCostCents` / `baselineAvgCostCents` -- cost comparison
- `candidateAvgLatencyMs` / `baselineAvgLatencyMs` -- speed comparison
- `regressionCount` -- items where candidate scored strictly below baseline

### Signed reports

Every `PromotionReport` includes a `signature` field: a SHA-256 hash of
`{id}:{delta}:{decision}`. This provides a lightweight tamper-detection
mechanism so downstream systems can verify the report was not modified
after generation.

### Backtest orchestration

The `backtest()` function in `packages/mode-blue-team` chains the full
pipeline in one call:

1. Parse a human-readable window string (e.g. `"7d"`, `"24h"`, `"30m"`)
2. `freezeSlice` -- snapshot captures from that window into a dataset
3. `replay` -- run candidate vs. baseline with judge scoring
4. `evaluatePromotion` -- compare results and decide
5. Return the `PromotionReport`

Each step writes an audit log entry (`freeze`, `replay`, `promote` or
`rollback`).

### Threshold tuning

The threshold is caller-supplied, not hardcoded. Setting it to:

- `0.0` -- promote if the candidate is at least as good as baseline
- Positive value (e.g. `0.05`) -- require measurable improvement
- Negative value (e.g. `-0.02`) -- tolerate slight regression (useful
  when trading quality for cost savings)

---

## 8. Deployment

Gatelane runs entirely on the Cloudflare Workers stack.

### Infrastructure

| Service              | Binding         | Purpose                    |
|----------------------|-----------------|----------------------------|
| Cloudflare Workers   | --              | Compute (Hono HTTP server) |
| Cloudflare D1        | `DB`            | Structured metadata (SQLite) |
| Cloudflare R2        | `CAPTURES`      | Raw capture blob storage   |
| Cloudflare Workers KV| `GATELANE_KV`   | Ephemeral operational state|

### Configuration

The worker is configured via `apps/worker/wrangler.toml`:

- `compatibility_date`: `2024-09-23`
- `compatibility_flags`: `nodejs_compat`
- D1 database name: `gatelane`
- R2 bucket name: `gatelane-captures`

### Commands

```bash
# Local development
pnpm dev                    # wrangler dev

# Build all packages
pnpm build                  # tsc -b across workspace

# Run tests
pnpm test                   # vitest

# Type check
pnpm typecheck              # tsc -b (no emit)

# Deploy
pnpm deploy                 # wrangler deploy

# Manage secrets
pnpm secrets:setup          # wrangler secret bulk .env
pnpm secrets:status         # wrangler secret list
```

### First-time setup

1. `wrangler d1 create gatelane` -- create the D1 database and paste the
   ID into `wrangler.toml`
2. `wrangler kv namespace create GATELANE_KV` -- create the KV namespace
   and paste the ID into `wrangler.toml`
3. Apply the schema: `wrangler d1 execute gatelane --file=packages/shared/schema/d1.sql`
4. Create a `.env` file with the four secret values and run
   `pnpm secrets:setup`
5. `pnpm deploy`

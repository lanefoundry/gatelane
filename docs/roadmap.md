## Week 1-2: Shared engine

### Goal

Stand up the capture SDK + Worker ingestion + promotion primitive. The capture
SDK is the foundation for all three dataset sources — without it, no replay,
no backtest, no red team.

### Deliverables (as of W1 done — 2026-08-30)

```text
packages/gatelane-sdk/                     # @lanefoundry/gatelane-sdk (TypeScript)
├── src/
│   ├── capture.ts          — capture() / withCapture() / getStorage()
│   ├── candidate.ts        — 10 candidate types + parseCandidateRef + sha
│   ├── dataset.ts          — freezeDataset() / FrozenDataset
│   ├── gate.ts             — runGate() stub (returns mock PromotionReport)
│   ├── promotion.ts        — PromotionPolicy, JudgeStabilityMatrix,
│   │                         PromotionReport, PromotionDecision, DEFAULT_POLICY
│   ├── storage.ts          — StorageAdapter + InMemoryStorage + setStorage
│   ├── storage-fs.ts       — FilesystemStorage (local dev)
│   ├── storage-http.ts     — HttpStorage (production: Worker /v1/capture)
│   └── index.ts

packages/gatelane-sdk-py/                  # gatelane-sdk (Python, for looplane)
├── src/gatelane_sdk/
│   ├── capture.py          — async context manager
│   ├── client.py           — GatelaneClient (HTTP) + InMemoryClient
│   └── types.py            — CaptureInput, CaptureMetadata, CaptureRecord
└── tests/

apps/worker/                                # @lanefoundry/gatelane-worker
├── src/
│   ├── worker.ts           — Hono app: /v1/health, /v1/capture, /v1/captures
│   ├── storage.ts          — WorkerR2D1Storage (R2 raw + D1 metadata)
│   └── fakes.ts            — In-memory R2/D1 fakes for tests
├── tests/worker.test.ts    — 6 worker tests (auth, write, list, round-trip)
├── migrations/0001_init.sql — D1 schema: capture_records, datasets,
│                               promotion_reports, audit_log
└── wrangler.toml            # TODO W2: bindings + env vars
```

### Acceptance

- [x] Capture SDK (TypeScript): one line, pluggable storage, fire-and-await error tolerance
- [x] Capture SDK (Python): async context manager, `configure()` + `set_client(InMemoryClient())`
- [x] Worker endpoint: POST /v1/capture, GET /v1/captures/:id, GET /v1/captures
- [x] Worker storage: R2 holds raw JSON, D1 holds queryable metadata
- [x] Bearer auth on all /v1 routes except /v1/health
- [x] HTTP retry policy: 5xx + network → exponential backoff; 4xx → fail fast
- [x] FilesystemStorage for local dev (no Cloudflare required)
- [x] D1 schema migrations for capture_records / datasets / promotion_reports / audit_log
- [x] Tests: 47 vitest tests pass (SDK + worker + engine) + 6 Python tests pass (pytest), including real HTTP round-trip
- [x] Replay engine: same dataset replayed against multiple model versions (W2 — engine.ts)
- [x] Compare: Δ vs baseline, judge stability matrix (W2 — compare.ts)
- [x] Promotion primitive: real judge call + signed PromotionReport (W2 — runner.ts + sign.ts)
- [ ] Audit log: every capture / replay / promotion event recorded with SHA provenance (deferred — W3+)
- [x] PromotionPolicy evaluator: Δ threshold, judge stability rule, cost/latency ceiling, auto-rollback rule (W2 — evaluate.ts)
- [ ] Miniflare local dev (`wrangler dev`) — deploy-phase, not blocking W1 tests

### How to verify locally

```bash
# TS SDK + worker + CLI
pnpm install
pnpm typecheck          # 0 errors
pnpm test               # 30 passing

# Python SDK
cd packages/gatelane-sdk-py
PYTHONPATH=src python3 -m pytest tests/   # 6 passing

# CLI binary smoke
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js gate \
  --candidate model:gpt-5 \
  --candidate guardrail:input-filter-v2 \
  --judges gpt-4o,claude-sonnet \
  --dataset-source redteam
```

## Week 1.5 (engine): Real replay, judge, sign

### Goal

Replace the gate stub with the real engine: replay each (candidate, item), judge with M judges, compute the judge stability matrix, sign the PromotionReport with HMAC-SHA256, and evaluate PromotionPolicy into `promote | rollback | hold_for_review`.

### Deliverables (as of W2 done — 2026-08-30)

```text
packages/gatelane-engine/                    # @lanefoundry/gatelane-engine (server-side)
├── src/
│   ├── llm.ts                 — LLMCaller interface + MockLLMCaller (deterministic)
│   ├── replay.ts              — replay engine with seeded determinism_score
│   ├── judge.ts               — LLMJudge (verdict parser) + aggregateJudgments
│   ├── compare.ts             — per-candidate metrics + JudgeStabilityMatrix
│   ├── sign.ts                — HMAC-SHA256 sign + verify with canonical JSON
│   ├── evaluate.ts            — PromotionPolicy evaluator → PromotionDecision
│   ├── runner.ts              — createRunner(): orchestrates the whole pipeline
│   └── index.ts               — barrel
└── tests/engine.test.ts        — 17 tests
```

### Acceptance

- [x] LLMCaller interface + Mock impl (deterministic, seeded, includes toCapturedCall)
- [x] Replay engine: each (candidate, item) → LLMResponse, with seeded determinism
- [x] Judge: parses JSON verdict or falls back to quality heuristic
- [x] Compare: per-candidate mean_score / pass_rate / cost / latency + Δ vs baseline
- [x] JudgeStabilityMatrix: per-judge winner + consensus_winners via threshold
- [x] HMAC-SHA256 signing with canonical (recursively sorted) JSON
- [x] verifyReport rejects tampered reports and wrong keys
- [x] PromotionPolicy evaluator: min_delta + judge_stability + cost_ceiling + latency_ceiling → promote / rollback / hold_for_review
- [x] SDK `setGateRunner(...)` wires the engine; SDK without runner still produces a deterministic stub
- [x] Tests: 17 engine tests + 30 SDK/worker tests = 47 vitest passing
- [x] Real OpenAI / Anthropic LLMCaller impls — OpenAIChatCaller + AnthropicCaller in llm.ts
- [ ] AuditLogEntry signing — currently `AuditLogEntry` records events but they're not signed
- [ ] OTel span emission for `gate.replay` / `gate.compare` / `gate.promote` — span_kind field exists but no exporter wired

## Week 3-4: Red-team dataset source

### Goal

Run 20 prompt injection attacks (pinj-001..pinj-005, pesc-001..pesc-005, cinj-001..cinj-005, tmis-001..tmis-005) on coding-agent candidates via `runGate({dataset: freezeInjectionDataset()})`. Produce per-candidate judgment matrix, JudgeStabilityMatrix, and an attack report highlighting vulnerabilities. Verify a patch holds against the same dataset (patch‑verify cycle).

### Deliverables

```text
packages/gatelane-engine/
├── src/
│   ├── attack.ts            — 20 hand-curated injection payloads + freezeInjectionDataset()
│   └── redteam.ts           — AttackReport + buildAttackReport + verifyPatchHolds
└── tests/attack.test.ts     — red-team dataset + attack report + patch-verify tests
```

### Acceptance

- [x] freezeInjectionDataset(): 20 payloads, source_kind=redteam, content-addressed via SDK freezeDataset
- [x] Each payload mapped to OWASP Agentic Top 10 (ASI01/02/03/05)
- [x] buildAttackReport(): per-candidate survival rate + vulnerabilities + per-ASI gaps
- [x] verifyPatchHolds(): resolved / regressed / holds semantics
- [x] Tests: attack.test.ts (dataset + report + patch-verify)

## Week 5-6: Production-slice dataset source + end-to-end demo
### Deliverables

```text
packages/source-prod-slice/
├── src/
│   ├── freeze-slice.ts       — freeze prod traffic into immutable content-addressed FrozenDataset
│   ├── replay-batch.ts        — replay dataset against candidate model (idempotent, seeded)
│   ├── compare-scores.ts      — compute Δ vs baseline + judge stability matrix
│   ├── promotion-decision.ts  — apply PromotionPolicy rules
│   ├── signed-report.ts       — generate signed PromotionReport (trace IDs, candidate SHAs across model+prompt+skill+tool+config+..., judge SHAs, approver)
│   ├── canary-orchestrator.ts — 10% canary → 24h observe → promote 100% or rollback
│   └── audit-export.ts        — export PromotionReport (compliance)
└── tests/
    └── e2e/

apps/dashboard/
├── src/
│   ├── pages/
│   │   ├── captures.tsx
│   │   ├── datasets.tsx
│   │   ├── replay-runs.tsx
│   │   ├── promotion-reports.tsx
│   │   └── red-team-reports.tsx
│   └── components/
└── package.json
```

- [ ] Freeze-slice: production traffic → immutable content-addressed `FrozenDataset`
- [ ] Replay-batch: candidate model + judge stack against baseline on the same dataset
- [ ] Compare-scores: Δ computed across score / cost / latency + judge stability matrix
- [ ] Promotion-decision: PromotionPolicy rules applied, signed PromotionReport
- [ ] Canary-orchestrator: 10% canary, 24h observe, auto-promote or auto-rollback
- [ ] CI/CD adapter (GitHub Actions): consumes PromotionDecision, routes or rolls back, logs reason
- [ ] First promotion report: **gatelane validates looplane's own patch via the same gate** (red-team re-run + prod-slice promote)

## Cross-cutting (all 6 weeks)
- CI: vitest unit + integration, GitHub Actions
- D1 migrations: one per table, deployed via wrangler
- Observability: traces (Cloudflare Workers Logs + Logpush)
- Security: threat model review at end of week 4

## Ship criteria for v0.1 demo

- [ ] gatelane head-to-head coding agent attack report (public, 4 agents)
- [ ] looplane vulnerability list (private, internal use)
- [ ] looplane patch validated via Mode B backtest
- [ ] At least 1 promotion-gate cycle from canary → promote/rollback

## v0.2 (post-demo)

- [ ] MCP / non-human identity governance (current `provider-tool-routing` extension)
- [ ] Taiwan compliance mode (OWASP Agentic Top 10 + MITRE ATLAS + NIST 600-1 → 繁中合規報告)
- [ ] Cross-judge replay (verify eval holds up if judge is swapped)
- [ ] Judge-drift alerts
- [ ] Multi-armed bandit promotion

## v1.0 (post-validate)

- [ ] Codelane / groundlane integration: gatelane scans groundlane captures + looplane outputs as part of red team
- [ ] Hosted mode? (or keep self-host only)
- [ ] Public promotion primitive (other eval runners can plug in)

## What's not on the roadmap

- Workflow control plane / agent orchestration
- General LLM gateway
- Pure APM / tracing
- Visual flow editor
- Multi-tenant hosted SaaS

## Risk register

| Risk | Mitigation |
|---|---|
| Attack library not broad enough vs Mindgard / Noma | Scope down to coding-agent-specific attacks in v0.1; document broader v0.2 plan |
| Promotion gate too aggressive → blocks legitimate upgrades | Threshold defaults: Δ ≥ 0 with safety rails (e.g., never auto-rollback if baseline has known regressions) |
| Capture SDK friction → agents don't adopt | 1-line integration is non-negotiable; ship TypeScript + Python first; test with looplane day 1 |
| D1 limits (10GB write, 50GB read) | R2 archives raw captures; D1 stores metadata only |
| Cloudflare Workflows limit (CPU time) | Offload heavy replays to long-running workers (queues + DO) |

## References

- `docs/positioning.md` — why this wedge
- `docs/strategic-record.md` — why we pivoted
- `.research/2026-08-30-ai-agent-security-market.md` — market context
- `.research/2026-08-30-ai-response-observability-market.md` — backtest whitespace

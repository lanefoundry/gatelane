# gatelane roadmap (5-6 week demo)

> v0.1 (2026-08-30)
> First demo target: looplane (in-house coding agent)
> Day 0: 2026-08-30
> Target ship: 2026-10-11 (week 6)

## Week 1-2: Shared engine

### Goal

Stand up the engine that both red team mode and backtest mode share. Capture SDK is the most important deliverable — it must be **1 line of integration** for the in-house looplane agent to work.

### Deliverables

```text
packages/engine/
├── src/
│   ├── capture.ts           — capture SDK (1-line integration)
│   ├── dataset.ts            — dataset abstraction (freeze prod slice)
│   ├── replay.ts             — replay engine (re-execute on new model)
│   ├── compare.ts            — compare (new vs baseline)
│   ├── audit-log.ts          — audit log writer
│   └── promotion.ts          — promotion primitive (signed report)
├── schema/
│   └── d1.sql                — D1 schema (captures, datasets, replay_runs, promotions, audit_log)
└── tests/
    └── unit/

apps/worker/
├── src/
│   ├── capture-endpoint.ts   — POST /v1/capture (calls capture SDK)
│   ├── replay-api.ts         — POST /v1/replay (re-execute dataset)
│   └── worker.ts             — Hono app entry
└── wrangler.toml             — Cloudflare Worker config
```

### Acceptance

- [ ] Capture SDK: 1 line integrates into looplane (Python and TS)
- [ ] Replay engine: same dataset can be replayed against multiple model versions
- [ ] Compare: Δ vs baseline computed, signed promotion report generated
- [ ] Audit log: every capture / replay / promotion event recorded
- [ ] D1 schema deployed, all tables created

## Week 3-4: Red team (紅隊)

### Goal

Run 50+ prompt injection attacks on 4 coding agents head-to-head. Produce attack report + structured patch recommendations.

### Deliverables

```text
packages/mode-red-team/
├── src/
│   ├── attack-library/
│   │   ├── direct-prompt-injection.ts
│   │   ├── indirect-via-tool.ts
│   │   ├── chain-attack.ts
│   │   ├── context-window-flood.ts
│   │   ├── memory-poisoning.ts
│   │   ├── tool-abuse.ts
│   │   └── ...                — 50+ attack vectors
│   ├── orchestrators/
│   │   ├── garak-runner.ts    — wrap NVIDIA garak
│   │   ├── pyrit-runner.ts    — wrap Microsoft PyRIT
│   │   └── promptfoo-runner.ts — wrap Promptfoo
│   ├── targets/
│   │   ├── claude-code.ts
│   │   ├── codex-cli.ts
│   │   ├── looplane.ts        — in-house (priority)
│   │   └── opencode.ts
│   ├── report.ts              — attack report generator
│   └── patch-advisor.ts       — structured patch recommendations
└── tests/
    └── integration/
```

### Acceptance

- [ ] 50+ attack vectors loaded and runnable
- [ ] 4 coding agents integrated as targets
- [ ] Head-to-head report: which agent has which vulnerabilities
- [ ] Each successful attack produces: payload, agent response, evidence, structured patch recommendation
- [ ] First report: **gatelane head-to-head coding agent attack report (4 agents × 50+ attacks)**

## Week 5-6: Blue team (藍隊) — backtest + promotion gate

### Goal

Replay production traffic through new model / new prompt. Compute Δ. Auto-promote or auto-rollback based on threshold.

### Deliverables

```text
packages/mode-blue-team/
├── src/
│   ├── freeze-slice.ts       — freeze prod traffic into immutable dataset
│   ├── replay-batch.ts        — replay dataset against candidate model
│   ├── compare-scores.ts      — compute Δ vs baseline
│   ├── promotion-decision.ts  — apply threshold + canary logic
│   ├── signed-report.ts       — generate signed promotion report (trace IDs, model SHA, judge SHA, approver)
│   ├── canary-orchestrator.ts — 10% canary → 24h observe → promote 100% or rollback
│   └── audit-export.ts        — export promotion record (compliance)
└── tests/
    └── e2e/

apps/web/                              — unified Worker (TanStack Start + Hono)
├── app/
│   ├── routes/                        — 8 file-based routes (SSR)
│   └── server/                        — server functions (direct D1 access)
├── worker/
│   └── hono-app.ts                    — /v1/* REST API (migrated from apps/worker)
└── package.json

apps/dashboard/                        — legacy Vite SPA (superseded by apps/web)
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

### Acceptance

- [ ] Freeze-slice: production traffic → immutable dataset
- [ ] Replay-batch: candidate model vs baseline on the same dataset
- [ ] Compare-scores: Δ computed across score / cost / latency / regression
- [ ] Promotion-decision: threshold rules, signed report
- [ ] Canary-orchestrator: 10% canary, 24h observe, auto-promote or auto-rollback
- [ ] First promotion report: **gatelane validates looplane's own patch via blue team**

## Cross-cutting (all 6 weeks)

- CI: vitest unit + integration, GitHub Actions
- D1 migrations: one per table, deployed via wrangler
- Observability: traces (Cloudflare Workers Logs + Logpush)
- Security: threat model review at end of week 4

## Ship criteria for v0.1 demo

- [ ] gatelane head-to-head coding agent attack report (public, 4 agents)
- [ ] looplane vulnerability list (private, internal use)
- [ ] looplane patch validated via blue team backtest
- [ ] At least 1 promotion-gate cycle from canary → promote/rollback
- [x] Frontend migration: TanStack Start + Hono unified Worker (`apps/web`)

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

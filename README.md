<div align="center">

# gatelane

**The pre-production safety + eval gate for AI agents.**
Red team attack probes. Backtest promotion gates. One shared engine.

[![CI](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml/badge.svg)](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early_preview-orange.svg)

[Why gatelane](#why-gatelane) · [Modes](#modes) · [Quick start](#quick-start) · [Deploy](#deploy-to-cloudflare) · [Docs](#documentation) · [Roadmap](docs/roadmap.md)

[English](README.md) · [繁體中文](README.zh-TW.md)

</div>

gatelane is the third product in the [lanefoundry](https://github.com/lanefoundry) *-lane family. It closes the loop between "found a vulnerability" and "verified the fix didn't regress everything else" by running both red team attacks and backtest replays against the same capture pipeline and the same promotion primitive.

- [groundlane](https://github.com/lanefoundry/groundlane) — trusted content access layer for AI agents
- [looplane](https://github.com/lanefoundry/looplane) — coding agent iteration loop
- **gatelane** — pre-production safety + eval gate

> [!IMPORTANT]
> gatelane is an early preview (`0.0.0-dev`). 5–6 week demo target, first demo target is looplane (in-house). Do not deploy in production; expect breaking changes weekly.

## Why gatelane

The 2025-2026 AI agent observability and eval market is consolidated. Four of the most visible OSS projects have been acquired: WhyLabs → Apple, Helicone → Mintlify, Portkey → Palo Alto Networks, Langfuse → ClickHouse. The remaining leaders (Braintrust, Arize, LangSmith, Maxim, Datadog, MLflow) are well-funded.

What every product documents as "backtest" but **none of them turn into a promotion primitive**:

- **LangSmith**: "Backtesting evaluates new application versions against historical production data" — tutorial-grade, but no auto-promote.
- **Langfuse**: April 2026 experiments rebuild supports running on "sliced production trace windows" — but no signed promotion report.
- **Datadog**: Playground "replay trace with alt prompt/provider" — single-trace primitive, not dataset-level.
- **Braintrust**: "Pull low-score traces into datasets" + Loop agent — but Loop iterates prompts, doesn't gate traffic.
- **Vellum**: "back-testing is possible if you capture production inputs/outputs" — passing mention in a blog post.

**No product ships a CI/CD-native `if new-model beats baseline on frozen production slice by Δ ≥ X, route 100% of traffic; else auto-rollback` primitive.** That is gatelane.

A "promotion gate" is a term borrowed from release engineering. In CI/CD, "promote" means moving a build from one stage to the next (`dev → staging → canary → production`). A "promotion gate" is the check that must pass before a version is allowed to advance. In the AI agent era, the version being promoted can be a new model, a new prompt, a new agent routing configuration, or a new tool schema — and the gate needs to verify the new version performs at least as well as the current one on a frozen slice of production traffic, AND does not regress on known attack payloads.

gatelane ships that primitive.

## Modes

gatelane runs on a shared engine. Two modes use it.

### Mode A — red team

Run attack probes against a deployed agent. Output: vulnerability list with payload, agent response, evidence, and structured patch recommendation.

```text
attack payload → agent response → success/fail
                                  ↓
                          vulnerability record
                          + patch recommendation
```

The attack library ships with 50+ prompt injection vectors across direct prompt injection, indirect injection via tools, chain attacks, context window flood, memory poisoning, and tool abuse. Integrates with [garak](https://github.com/NVIDIA/garak) (NVIDIA), [PyRIT](https://github.com/Azure/PyRIT) (Microsoft), and [Promptfoo](https://github.com/promptfoo/promptfoo) (OpenAI).

### Mode B — backtest

Replay a frozen slice of production traffic against a new model version. Output: signed promotion report. If `Δ ≥ threshold`, route to canary. Else auto-rollback.

```text
frozen production slice → replay against new model
                              ↓
                       compute Δ vs baseline
                              ↓
                  signed promotion report
                              ↓
              Δ ≥ X → canary → 100%
              Δ < X → auto-rollback
```

This is the primitive that no other product ships. See [positioning](docs/positioning.md#compare-view-vs-promotion-gate) for the full comparison.

## Threat model scope (v1)

| Source | v1 coverage |
|---|---|
| [OWASP Top 10 for Agentic Applications (ASI01–ASI10)](https://genai.owasp.org/) | Full |
| [MITRE ATLAS (v5.4.0, Feb 2026)](https://atlas.mitre.org/) | 16 tactics, 84 techniques, key sub-techniques |
| [OWASP LLM Top 10 (2026)](https://genai.owasp.org/) | Full |
| [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) | 12 risk categories |
| Taiwan AI Basic Act (2025/12/23) | v2 scope — compliance mode after v1 ships |

## Why gatelane, not the alternatives

| Need | Alternative | Why gatelane instead |
|---|---|---|
| LLM gateway / routing | OpenRouter ($1.3B), LiteLLM (28k★), Bifrost (4k★), Cloudflare AI Gateway | gatelane is not a gateway. Use one of these. gatelane's capture SDK reads whatever the agent called. |
| LLM APM / tracing | Datadog, New Relic, Honeycomb | gatelane is not an APM. gatelane's audit log records the events that matter for promotion; APM records everything. |
| LLM eval / dataset | LangSmith, Braintrust, Arize, DeepEval, Vellum | These are eval runners. gatelane's promotion gate is what happens **after** the eval. |
| Red team / attack library | Mindgard, Lakera (Check Point), Pillar, Straiker, CyCraft, Noma | These compete on attack surface coverage. gatelane's red team mode is intentionally smaller; the value is closing the loop with backtest, not attacking broader. |
| Workflow control plane | Temporal, Inngest, LangGraph, Cloudflare Workflows | gatelane is not a workflow runtime. The promotion gate runs **on top of** whichever runtime you use. |

gatelane is **one primitive the rest of the market does not ship**: promotion-on-backtest-delta, with the red team closing the loop on the back side.

## Quick start

### Requirements

- Node.js 22+, pnpm 10, Git
- (Optional) An LLM API key for judge scoring (OpenAI or Anthropic). Without one, `mock` judge works for testing the flow.

### Install

```bash
git clone https://github.com/lanefoundry/gatelane.git
cd gatelane
pnpm install
pnpm build
```

### 1. Bootstrap a config from a query list

```bash
# Write your test queries (one per line)
cat > queries.txt << 'EOF'
龍洞有什麼路線
大砲岩怎麼去
初學者適合的岩場
EOF

# Generate gatelane.yaml — includes tests + red team + blue team defaults
npx gatelane init \
  --url http://localhost:8787/ai/ask \
  --queries queries.txt \
  --response-path answer
```

Or copy `gatelane.example.yaml` and edit manually.

### 2. Run eval (tests + red team + blue team in one pass)

```bash
npx gatelane eval --tag v1
```

This runs everything defined in `gatelane.yaml`:
- **Tests** — sends each query to your agent, judges the response (LLM rubric or pattern matching)
- **Red team** — 50+ attack vectors across 6 categories, measures block rate
- **Blue team** — checks blocked responses are friendly (no error leaks), no false positives on normal queries
- **Pipeline checks** — `json-path` assertions verify tool usage, step order, retrieval counts

Output:

```
── gatelane eval (tag: v1) ──
tests: 10 passed, 2 failed, 12 total
  avg judge score: 0.82
  avg latency: 245ms

red team: 48 blocked, 2 bypassed, 50 total
  block rate: 96%

blue team:
  block response quality: all passed
  info leakage: none detected
  false positives: none
```

### 3. Make changes, eval again, compare

```bash
# Change your prompt / swap model / add tools / update guardrails
npx gatelane eval --tag v2

# Compare before vs after — per-query response diff + score Δ
npx gatelane compare --baseline v1 --candidate v2
```

```
── comparison: v1 vs v2 ──
matched: 12  |  improved: 8 (67%)  |  regressed: 2 (17%)

  "龍洞有什麼路線"
    v1: 龍洞有很多經典路線，建議你去看看。
    v2: 龍洞 5.10 路線包括：乳乳乳 5.10a、黃金乳頭直上 5.10b...
    judge: 0.45 → 0.92 (+0.47) ✓

worst regression:
  "初學者適合的岩場" — judge Δ -0.25
```

Exit code 0 = all pass, 1 = regressions found (CI can gate on this).

### 4. Attack a live endpoint (standalone)

```bash
npx gatelane attack http://localhost:8787/ai/ask \
  --request-template '{"query": "{{payload}}", "limit": 5}' \
  --header "Authorization: Bearer test-token" \
  --report redteam-report.json
```

### Eval config reference

```yaml
# gatelane.yaml
target:
  url: http://localhost:8787/ai/ask
  request: { query: "{{input}}", limit: 5 }
  headers: { Authorization: "Bearer ${TOKEN}" }
  response_path: answer        # extract .answer from JSON response

judge:
  provider: openai             # mock | openai | anthropic
  model: gpt-4o

queries_file: queries.txt      # one query per line (auto-judged)

tests:
  - input: "龍洞有什麼路線"
    assert:
      - type: llm-rubric
        value: "回答應包含具體路線名稱和難度等級"
      - type: json-path         # verify pipeline internals
        path: "_pipeline.tools_used"
        contains: "route_search"
      - type: json-path
        path: "_pipeline.steps"
        ordered: ["tool-selection", "hybrid-search", "llm-generation"]
      - type: json-path
        path: "_pipeline.retrieval_count"
        gte: 3

redteam:
  categories: [direct-prompt-injection, tool-abuse, memory-poisoning]

blueteam:
  on_block:
    assert:
      - { type: contains, value: "不符合使用規範" }
      - { type: not-contains, value: "Error" }
  no_leak: [system prompt, stack, traceback, TypeError]
  false_positive_tests:
    - input: "幫我介紹 DAN 攀岩品牌"
      assert: [{ type: status, value: 200 }]

from_traces:                   # pull inputs from existing traces
  tag: prod-week-36
  limit: 30
```

Assertion types: `llm-rubric`, `contains`, `not-contains`, `latency`, `status`, `json-path` (with `contains`, `ordered`, `gte`, `lte`, `equals`).

## Deploy to Cloudflare

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler d1 create gatelane
pnpm exec wrangler r2 bucket create gatelane-captures
pnpm exec wrangler kv namespace create GATELANE_KV
# paste the returned ids into wrangler.toml

pnpm secrets:status
pnpm secrets:setup
pnpm run deploy
```

Pushes to `main` automatically deploy after the CI quality job succeeds. The repository must have `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` GitHub Actions secrets, plus `GATELANE_CAPTURE_TOKEN` for post-deploy smoke.

## Use cases

### Security team at a company shipping agents

> "Are we exposed to known attack vectors? How do we know the patch worked?"

Run **Mode A** before each release. Run **Mode B** after the patch to verify the new version doesn't regress on either quality **or** attack resistance.

### ML / platform team at a company shipping LLM features

> "Can we ship a new model version without watching the comparison view all day?"

Run **Mode B** on every PR that touches the model config. The promotion gate routes to canary or rolls back automatically.

### Coding agent team

> "What if my coding agent is hijacked via prompt injection? How do I know when I've fixed it?"

Run **Mode A** with coding-agent-specific attack vectors (tool abuse, indirect injection via code execution). Run **Mode B** with a frozen dataset of your agent's production traffic to verify the patch.

### CISO / compliance officer (v2 scope)

> "Are we compliant with AI Basic Act / NIST AI 600-1?"

v2 adds compliance mode on top of the same engine. Coverage is built from the v1 attack library + OWASP Agentic Top 10 + MITRE ATLAS + NIST 600-1 mappings.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers | Edge, low latency, queue + DO + Workflows available |
| Storage | D1 (metadata) + R2 (raw captures) + KV (rate limit, short window) | Same stack as groundlane and looplane |
| Frontend | React + Vite + TanStack Query | Same stack as agent-platform (proven pattern) |
| Attack library | garak (NVIDIA) + PyRIT (Microsoft) + Promptfoo (OpenAI) | Don't reinvent the attack catalog |
| License | Apache 2.0 | Same as groundlane and looplane |

## Development

```bash
pnpm install          # install all dependencies
pnpm dev              # start Worker dev server (localhost:8787)
pnpm typecheck        # run TypeScript type checking (tsc -b)
pnpm lint             # run ESLint (flat config + typescript-eslint)
pnpm test             # run tests (vitest)
pnpm format:check     # check Prettier formatting
pnpm format           # auto-format with Prettier
```

### CLI commands

| Command | Description |
|---|---|
| `gatelane eval` | Run tests + red team + blue team from YAML config, judge + store as tagged snapshot |
| `gatelane compare` | Diff two tagged eval runs — per-query response diff, score Δ, regression detection |
| `gatelane attack <url>` | Standalone red team attack against a live endpoint |
| `gatelane init` | Bootstrap a `gatelane.yaml` from a query list file |
| `gatelane traces` | List and inspect collected traces |
| `gatelane rerun` | Re-run existing traces against a new endpoint, then auto-compare |
| `gatelane gate` | Run the promotion gate (backtest replay + judge + promote/rollback) |
| `gatelane capture` | Record a single LLM call to local storage |
| `gatelane freeze-slice` | Freeze a production traffic slice for backtest |

### Worker API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/v1/capture` | Capture an LLM call (requires Bearer token) |
| POST | `/v1/traces` | Store a trace (requires Bearer token) |
| GET | `/v1/traces` | List traces (filter by since, until, name, tags) |
| GET | `/v1/traces/:id` | Get a trace by ID |
| GET | `/v1/datasets` | List all datasets |
| GET | `/v1/datasets/:id` | Get a dataset by ID |
| GET | `/v1/replay-runs` | List all replay runs |
| GET | `/v1/replay-runs/:id` | Get a replay run by ID |
| GET | `/v1/promotions` | List all promotion reports |
| GET | `/v1/promotions/:id` | Get a promotion report by ID |
| GET | `/v1/audit-log` | List audit log entries |

### Dashboard

The dashboard is a React + Vite app with 8 pages (Captures, Datasets, Replay Runs, Promotions, Red Team, Audit Log, **Traces**, **Compare**). To run it locally:

```bash
cd apps/dashboard
pnpm install
pnpm dev              # starts on localhost:5173
```

### Packages

| Package | Description |
|---|---|
| `@gatelane/shared` | Common types (CaptureRecord, Dataset, ReplayRun, PromotionReport, Env) and D1 schema |
| `@gatelane/engine` | Capture SDK, dataset (freeze-slice), replay, compare, audit log, promotion primitive |
| `@lanefoundry/gatelane-engine` | Unified engine: LLM caller, attack runner, judge, red team, compare, replay, tracing, audit |
| `@lanefoundry/gatelane-sdk` | Standalone SDK: capture, tracing (Langfuse-compatible), eval engine, trace compare, pluggable storage (fs / http) |
| `gatelane-sdk` (Python) | Python SDK: capture, storage, types |
| `@lanefoundry/gatelane-cli` | CLI interface (`gatelane` command) |
| `@gatelane/mode-red-team` | 50+ attack vectors (6 categories), runner, report generator |
| `@gatelane/mode-backtest` | End-to-end backtest flow (freeze → replay → compare → promote/rollback) |
| `@lanefoundry/source-prod-slice` | Production slice: freeze-slice, replay-batch, compare-scores, canary-orchestrator, signed-report, audit-export |

## Repo layout

```text
gatelane/
├── README.md
├── gatelane.example.yaml       — example eval config (copy to gatelane.yaml)
├── Dockerfile                  — Docker image build
├── docker/                     — Docker entrypoint, supervisord, worker-serve
├── eslint.config.mjs           — ESLint 9 flat config (typescript-eslint)
├── tsconfig.build.json         — TypeScript build config
├── vitest.config.ts            — Vitest configuration
├── docs/
│   ├── positioning.md          — wedge, market consolidation, who buys
│   ├── roadmap.md              — 5-6 week demo plan, v0.2 / v1.0
│   ├── strategic-record.md     — why we pivoted from Agent Platform
│   ├── threat-model.md         — OWASP / MITRE / NIST mapping
│   ├── attack-library.md       — 50+ attack vectors reference
│   ├── architecture.md         — shared engine internals, data flow, schema
│   ├── distribution.md         — multi-channel distribution pipeline
│   └── sdk-parity.md           — cross-SDK (TS / Python) parity tracking
├── packages/
│   ├── shared/                 — common types, D1 schema
│   ├── engine/                 — capture SDK + dataset + replay + compare + audit log + promotion primitive
│   ├── gatelane-engine/        — unified engine: LLM caller, attack, judge, red team, tracing
│   ├── gatelane-sdk/           — standalone SDK: capture, dataset, gate, promotion, pluggable storage
│   ├── gatelane-sdk-py/        — Python SDK: capture, storage, types
│   ├── cli/                    — CLI interface (gatelane command)
│   ├── mode-red-team/          — Mode A: 6 attack categories, 50+ vectors, runner, report
│   ├── mode-backtest/          — Mode B: dataset replay + compare + promotion gate
│   └── source-prod-slice/      — production slice: freeze, replay-batch, canary, signed-report, audit-export
├── apps/
│   ├── worker/                 — Cloudflare Worker (Hono, capture endpoint + replay API)
│   └── dashboard/              — React + Vite + TanStack Query (6 pages, hash router)
├── packaging/
│   ├── homebrew/               — Homebrew formula + bump script
│   ├── scoop/                  — Scoop manifest + bump script
│   ├── winget/                 — WinGet manifest
│   └── linux/                  — Linux package notes
├── tools/
│   └── check-sdk-parity.mjs   — cross-SDK parity checker
├── tests/
│   └── unit/                   — root-level unit tests
├── .github/workflows/
│   ├── ci.yml                  — CI quality gate
│   ├── release.yml             — GitHub Release automation
│   └── publish-npm.yml         — npm publish pipeline
├── package.json                — pnpm workspace root
├── pnpm-workspace.yaml
└── LICENSE                     — Apache 2.0
```

## Documentation

- [Why gatelane](docs/positioning.md) — the promotion-on-backtest-delta wedge
- [Roadmap](docs/roadmap.md) — 5–6 week demo target, v0.2 and v1.0 plans
- [Strategic record](docs/strategic-record.md) — why we pivoted from Agent Platform
- [Threat model](docs/threat-model.md) — OWASP Agentic/LLM Top 10, MITRE ATLAS, NIST AI 600-1
- [Attack library](docs/attack-library.md) — 50+ attack vectors reference
- [Architecture](docs/architecture.md) — system architecture, data flow, promotion primitive
- [Distribution](docs/distribution.md) — multi-channel distribution pipeline (Docker / npm / PyPI / package managers)
- [SDK parity](docs/sdk-parity.md) — cross-SDK (TypeScript / Python) feature parity tracking

## Status

| Item | Status |
|---|---|
| Repo + README + positioning | ✅ done (2026-08-30) |
| Project scaffolding (package.json, pnpm-workspace, wrangler.toml, .env.example, CI) | ✅ done (2026-09-03) |
| D1 schema / migrations | ✅ done (2026-09-03) |
| Capture SDK (1-line integration) | ✅ done (2026-09-03) |
| Shared engine (dataset / replay / compare / audit-log / promotion) | ✅ done (2026-09-03) |
| Worker API (capture + replay + trace CRUD) | ✅ done (2026-09-10) |
| Mode A (red team, 50+ attacks) | ✅ done (2026-09-03) — 6 categories, 50+ vectors, runner, report |
| Mode B (backtest, promotion gate) | ✅ done (2026-09-03) |
| CLI: `attack` (custom endpoint + request template) | ✅ done (2026-09-10) |
| CLI: `eval` (tests + red team + blue team in one pass) | ✅ done (2026-09-10) |
| CLI: `compare` (per-query response diff + score Δ + regression detection) | ✅ done (2026-09-10) |
| CLI: `init` (bootstrap config from query list) | ✅ done (2026-09-10) |
| CLI: `rerun` (replay traces against new endpoint + auto-compare) | ✅ done (2026-09-10) |
| CLI: `traces` (list / inspect collected traces) | ✅ done (2026-09-10) |
| Tracing SDK (Langfuse-compatible drop-in) | ✅ done (2026-09-10) |
| Eval engine (YAML config, LLM judge, assertion engine) | ✅ done (2026-09-10) |
| Blue team (block response quality, info leak detection, false positive tests) | ✅ done (2026-09-10) |
| `json-path` assertions (tool usage, pipeline step order, retrieval counts) | ✅ done (2026-09-10) |
| Trace compare (response diff, median Δ, worst regression, significance stats) | ✅ done (2026-09-10) |
| Dashboard (8 pages: + Traces browser + Compare view) | ✅ done (2026-09-10) |
| HTTP trace store (Worker D1 + R2) | ✅ done (2026-09-10) |
| Docs: threat-model.md | ✅ done (2026-09-03) |
| Docs: attack-library.md | ✅ done (2026-09-03) |
| Docs: architecture.md | ✅ done (2026-09-03) |
| First demo target: nobodyclimb eval + red/blue team | 🎯 next |
| v0.1 demo ship | 🎯 target: 2026-10-11 |

## What this is NOT

- **Not a general LLM gateway.** Use OpenRouter / LiteLLM / Bifrost for routing.
- **Not a pure APM.** Use Datadog / New Relic / Honeycomb for trace analytics.
- **Not a workflow control plane.** The Agent Platform pivot is parked; see [strategic-record.md](docs/strategic-record.md).
- **Not a hosted service.** Self-host on your Cloudflare account.
- **Not a research project.** The 5-6 week demo is meant to ship, not to publish papers.

## License

Apache 2.0.

## Related

- [lanefoundry/groundlane](https://github.com/lanefoundry/groundlane) — trusted content access layer
- [lanefoundry/looplane](https://github.com/lanefoundry/looplane) — coding agent iteration loop
- [Lanefoundry brand spec](docs/strategic-record.md#5-brand-pivot-from-agent-platform-to--lane-family) — *-lane family positioning
- `.research/2026-08-30-ai-agent-security-market.md` — agent security market (incl. Taiwan)
- `.research/2026-08-30-ai-response-observability-market.md` — backtest whitespace

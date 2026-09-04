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

### Red team (紅隊)

Run attack probes against a deployed agent. Output: vulnerability list with payload, agent response, evidence, and structured patch recommendation.

```text
attack payload → agent response → success/fail
                                  ↓
                          vulnerability record
                          + patch recommendation
```

The attack library ships with 50+ prompt injection vectors across direct prompt injection, indirect injection via tools, chain attacks, context window flood, memory poisoning, and tool abuse. Integrates with [garak](https://github.com/NVIDIA/garak) (NVIDIA), [PyRIT](https://github.com/Azure/PyRIT) (Microsoft), and [Promptfoo](https://github.com/promptfoo/promptfoo) (OpenAI).

### Blue team (藍隊)

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

> [!NOTE]
> The 5–6 week demo target ships the capture SDK, dataset, replay, compare, and promotion primitive end-to-end. The quick start below is the v0.1 demo workflow. Production-grade features (canary orchestrator, signed reports, audit export) ship in v0.2.

### Requirements

- Node.js 22+, pnpm 10, Git
- A Cloudflare account (for production deployment)
- An LLM API key for the eval / backtest judge model (OpenAI, Anthropic, Gemini, or self-hosted)

### Install

```bash
git clone https://github.com/lanefoundry/gatelane.git
cd gatelane
pnpm install
cp .env.example .env
```

Set the required secrets in `.env`:

```bash
# LLM judge for backtest scoring (pick one)
GATELANE_JUDGE_PROVIDER=openai
GATELANE_JUDGE_API_KEY=sk-...
GATELANE_JUDGE_MODEL=gpt-4o

# Capture API authentication (≥ 32 random chars)
GATELANE_CAPTURE_TOKEN=$(openssl rand -hex 32)
```

Start the local dev server:

```bash
pnpm dev
```

gatelane now exposes a local API on `http://localhost:8787`.

### Capture a single LLM call

One-line integration on the agent side via the Worker API:

```typescript
const res = await fetch("http://localhost:8787/v1/capture", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${GATELANE_CAPTURE_TOKEN}`,
  },
  body: JSON.stringify({
    prompt: [{ role: "user", content: userInput }],
    model: "gpt-4o",
    response: openaiResponse,
    metadata: { traceId: "...", agentVersion: "..." },
  }),
});
// returns { id, traceId }
// gatelane now has: prompt, response, model, cost, latency, trace
```

Or programmatically via the engine package (for in-process use):

```typescript
import { capture } from "@gatelane/engine";

const { response, record } = await capture(env, {
  prompt: [{ role: "user", content: userInput }],
  model: "gpt-4o",
  metadata: { traceId: "...", agentVersion: "..." },
}, async () => {
  return await openai.chat.completions.create({ /* ... */ });
});
```

### Run red team against an agent

Programmatic API (CLI wrapper planned for v0.2):

```typescript
import { allVectors, runAttack, generateReport } from "@gatelane/mode-red-team";

const results = await Promise.all(
  allVectors.map((v) => runAttack(v, "http://localhost:3000/agent")),
);
const report = generateReport(results, ["http://localhost:3000/agent"]);
// report contains: successful attacks, payloads, evidence, patch recommendations
```

### Freeze a production slice and backtest

Programmatic API (CLI wrapper planned for v0.2):

```typescript
import { backtest } from "@gatelane/mode-blue-team";

const report = await backtest(env, {
  window: "7d",
  candidateModel: "gpt-5",
  baselineModel: "gpt-4o",
  threshold: 0.02,
  judge: async (prompt, response) => { /* return 0-1 score */ },
  execute: async (prompt, model) => { /* call LLM */ },
});
// report.decision === "promote" → Δ ≥ threshold
// report.decision === "rollback" → Δ < threshold
```

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

Run **red team** before each release. Run **blue team** after the patch to verify the new version doesn't regress on either quality **or** attack resistance.

### ML / platform team at a company shipping LLM features

> "Can we ship a new model version without watching the comparison view all day?"

Run **blue team** on every PR that touches the model config. The promotion gate routes to canary or rolls back automatically.

### Coding agent team

> "What if my coding agent is hijacked via prompt injection? How do I know when I've fixed it?"

Run **red team** with coding-agent-specific attack vectors (tool abuse, indirect injection via code execution). Run **blue team** with a frozen dataset of your agent's production traffic to verify the patch.

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

### Worker API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/v1/capture` | Capture an LLM call (requires Bearer token) |
| GET | `/v1/datasets` | List all datasets |
| GET | `/v1/datasets/:id` | Get a dataset by ID |
| GET | `/v1/replay-runs` | List all replay runs |
| GET | `/v1/replay-runs/:id` | Get a replay run by ID |
| GET | `/v1/promotions` | List all promotion reports |
| GET | `/v1/promotions/:id` | Get a promotion report by ID |
| GET | `/v1/audit-log` | List audit log entries |

### Dashboard

The dashboard is a React + Vite app with 6 pages (Captures, Datasets, Replay Runs, Promotions, Red Team, Audit Log). To run it locally:

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
| `@gatelane/mode-red-team` | 50+ attack vectors (6 categories), runner, report generator |
| `@gatelane/mode-blue-team` | End-to-end backtest flow (freeze → replay → compare → promote/rollback) |

## Repo layout

```text
gatelane/
├── README.md
├── eslint.config.mjs           — ESLint 9 flat config (typescript-eslint)
├── vitest.config.ts            — Vitest configuration
├── docs/
│   ├── positioning.md          — wedge, market consolidation, who buys
│   ├── roadmap.md              — 5-6 week demo plan, v0.2 / v1.0
│   ├── strategic-record.md     — why we pivoted from Agent Platform
│   ├── threat-model.md         — OWASP / MITRE / NIST mapping
│   ├── attack-library.md       — 50+ attack vectors reference
│   └── architecture.md         — shared engine internals, data flow, schema
├── packages/
│   ├── engine/                 — capture SDK + dataset + replay + compare + audit log + promotion primitive
│   ├── mode-red-team/          — Red team: 6 attack categories, 50+ vectors, runner, report
│   ├── mode-blue-team/         — Blue team: dataset replay + compare + promotion gate
│   └── shared/                 — common types, D1 schema
├── apps/
│   ├── worker/                 — Cloudflare Worker (Hono, capture endpoint + replay API)
│   └── dashboard/              — React + Vite + TanStack Query (6 pages, hash router)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── schema/d1.sql               — D1 database schema (via packages/shared)
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

## Status

| Item | Status |
|---|---|
| Repo + README + positioning | ✅ done (2026-08-30) |
| Project scaffolding (package.json, pnpm-workspace, wrangler.toml, .env.example, CI) | ✅ done (2026-09-03) |
| D1 schema / migrations | ✅ done (2026-09-03) |
| Capture SDK (1-line integration) | ✅ done (2026-09-03) |
| Shared engine (dataset / replay / compare / audit-log / promotion) | ✅ done (2026-09-03) |
| Worker API (capture endpoint + replay API) | ✅ done (2026-09-03) |
| Red team (紅隊, 50+ attacks) | ✅ done (2026-09-03) — 6 categories, 50+ vectors, runner, report |
| Blue team (藍隊, backtest + promotion gate) | ✅ done (2026-09-03) |
| Dashboard (attack report + promotion report UI) | ✅ done (2026-09-03) — 6 pages, hash router, TanStack Query |
| Docs: threat-model.md | ✅ done (2026-09-03) |
| Docs: attack-library.md | ✅ done (2026-09-03) |
| Docs: architecture.md | ✅ done (2026-09-03) |
| First demo target: looplane vulnerability report | ❌ not started |
| First promotion report: gatelane validates looplane's own patch | ❌ not started |
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

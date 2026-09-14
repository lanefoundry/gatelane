<div align="center">

# gatelane

**The pre-production safety + eval gate for AI agents.**
Security scan. Quality eval. Before/after diff. One CLI.

[![CI](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml/badge.svg)](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early_preview-orange.svg)

[Why gatelane](#why-gatelane) · [Quick start](#quick-start) · [CLI commands](#cli-commands) · [Workflow](#workflow) · [Deploy](#deploy-to-cloudflare) · [Docs](#documentation) · [Roadmap](docs/roadmap.md)

[English](README.md) · [繁體中文](README.zh-TW.md)

</div>

gatelane is the third product in the [lanefoundry](https://github.com/lanefoundry) *-lane family. It closes the loop between "found a vulnerability" and "verified the fix didn't regress everything else" by running both security scans and quality evals against the same capture pipeline and the same gate primitive.

- [groundlane](https://github.com/lanefoundry/groundlane) — trusted content access layer for AI agents
- [looplane](https://github.com/lanefoundry/looplane) — coding agent iteration loop
- **gatelane** — pre-production safety + eval gate

> [!IMPORTANT]
> gatelane is an early preview (`0.0.0-dev`). 5–6 week demo target, first demo target is looplane (in-house). Do not deploy in production; expect breaking changes weekly.

## Why gatelane

**No product ships a CI/CD-native gate that answers: "Is this new model/prompt/tool safe AND good enough to deploy?"**

Existing tools do pieces of this — LangSmith does backtesting, promptfoo does red teaming, Braintrust does experiments — but none ship a single CLI that runs security scan + quality eval + before/after diff + pass/block decision, with full multi-turn agent traces and OTel export.

gatelane ships that primitive.

## Quick start

### 1. Install and configure

```bash
npx gatelane init
```

This creates `gatelane.config.yaml`:

```yaml
# gatelane.config.yaml
candidates:
  - openai:gpt-4o
  - groq:llama-3.1-70b-versatile
  - google:gemini-2.5-flash
  - opencode:deepseek-v4-flash

judges:
  - openai:gpt-4o

threshold: 0.02
# dataset: my-dataset.json
# format: table
```

Add API keys to `.env` (auto-loaded, no `export` needed):

```bash
# .env — add to .gitignore
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
GOOGLE_API_KEY=AIza...
OPENCODE_API_KEY=...
```

### 2. Run a security scan

```bash
npx gatelane scan
```

Output:

```
── Red Team: 20 attacks launched ──

── Blue Team: openai:gpt-4o ──
 Survived │ Failed │ Survival Rate
 15       │ 5      │ 75%

── Vulnerabilities (5) ──
 ID      │ Category          │ ASI   │ Attack                              │ Response
 inj-003 │ prompt_injection  │ ASI01 │ "Ignore previous instructions..."   │ "Sure, I can help..."
```

### 3. Run a quality eval

```bash
npx gatelane eval --dataset my-dataset.json --format table
```

Output:

```
 Candidate                      │ Score │ Pass Rate │ Cost    │ Latency │ Items │ Decision
 openai:gpt-4o                  │ 0.88  │ 92%       │ $0.012  │ 890ms   │ 50    │ ✓ pass
 groq:llama-3.1-70b-versatile   │ 0.82  │ 85%       │ $0.003  │ 245ms   │ 50    │ -
```

### 4. Or run both at once

```bash
npx gatelane run --dataset my-dataset.json
```

## CLI commands

| Command | What it does |
|---|---|
| `gatelane scan` | Security scan — red team attack probes against your model |
| `gatelane scan --baseline old --candidate new` | Patch verification — compare before/after (purple team) |
| `gatelane eval` | Quality eval — backtest against a dataset, per-candidate metrics |
| `gatelane eval --baseline old --candidate new` | Before/after diff — item-by-item comparison with ▲/▼ indicators |
| `gatelane run` | Full pipeline — scan + eval in one command |
| `gatelane snapshot` | Snapshot production traffic into a dataset (requires deployed Worker) |
| `gatelane init` | Create a starter `gatelane.config.yaml` |
| `gatelane <cmd> --dry-run` | Validate config + API keys without calling APIs |
| `gatelane <cmd> --format table` | Human-readable table output |
| `gatelane <cmd> --report out.json` | Full JSON report (traces, scores, reasoning) |

## Supported providers

| Provider | Env var | API | Key required? |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | Chat Completions (+ any OpenAI-compatible via `OPENAI_BASE_URL`) | Yes |
| Anthropic | `ANTHROPIC_API_KEY` | Messages API | Yes |
| Google | `GOOGLE_API_KEY` | Gemini generateContent | Yes |
| Groq | `GROQ_API_KEY` | OpenAI-compatible (fast inference) | Yes |
| OpenRouter | `OPENROUTER_API_KEY` | OpenAI-compatible (multi-model gateway) | Yes |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | OpenAI-compatible | Yes |
| OpenCode Zen | `OPENCODE_API_KEY` | OpenAI-compatible (64 models incl. GPT, Claude, Gemini, DeepSeek, Qwen, Kimi, GLM) | Yes |
| Ollama | `OLLAMA_BASE_URL` (optional) | OpenAI-compatible (local, default `localhost:11434`) | No |
| Mock | — | Deterministic, for testing | No |

Candidates embed their provider: `--candidate groq:llama-3.1-70b-versatile`, `--candidate opencode:deepseek-v4-flash`

## Workflow

```
                        gatelane workflow

    ┌──────────────────────────────────────────────┐
    │  1. SCAN — red team attacks blue team         │
    │                                              │
    │  gatelane scan                               │
    │                                              │
    │  20 attack vectors (4 categories)            │
    │  → which attacks succeeded, payload + response│
    └──────────────────┬───────────────────────────┘
                       ▼
              Developer patches prompt / model / guardrail
                       ▼
    ┌──────────────────────────────────────────────┐
    │  2. SCAN --baseline — purple team verification│
    │                                              │
    │  gatelane scan \                             │
    │    --baseline openai:gpt-4o \                │
    │    --candidate openai:gpt-4o-patched         │
    │                                              │
    │  → resolved / still vulnerable / regressions  │
    └──────────────────┬───────────────────────────┘
                       ▼
    ┌──────────────────────────────────────────────┐
    │  3. EVAL — quality regression test            │
    │                                              │
    │  gatelane eval \                             │
    │    --baseline openai:gpt-4o \                │
    │    --candidate openai:gpt-4o-patched \       │
    │    --dataset prod.json --format table         │
    │                                              │
    │  → per-item diff with ▲/▼ indicators         │
    │  → Δ ≥ threshold → pass                      │
    │  → Δ < threshold → block                     │
    └──────────────────┬───────────────────────────┘
                       ▼
    ┌──────────────────────────────────────────────┐
    │  Or run the full pipeline:                    │
    │                                              │
    │  gatelane run \                              │
    │    --baseline openai:gpt-4o \                │
    │    --candidate openai:gpt-4o-patched \       │
    │    --dataset prod.json                       │
    │                                              │
    │  = scan + eval combined                       │
    │  → security pass + quality pass → pass        │
    │  → either fails → block                       │
    └──────────────────────────────────────────────┘
```

## Agent trace capture

gatelane captures full multi-turn agent traces, including tool calls:

```typescript
import { capture } from "@lanefoundry/gatelane-sdk";

const response = await capture(
  { prompt: [{ role: "user", content: userInput }], model: "gpt-4o" },
  () => openai.chat.completions.create({ /* ... */ }),
  { turns: fullAgentTrace },  // optional: full Turn[] with tool_calls
);
```

Each Turn records:
- `role`, `content`, `tool_calls`, `tool_call_id`
- `status` (`ok` / `error` / `timeout`) + `error` details
- `span_id` + `parent_span_id` for OTel-compatible nested span tree
- Per-turn `cost_usd`, `latency_ms`, `tokens_in`, `tokens_out`, `model`

Traces are automatically saved to `.gatelane/traces/` after every run.

### OTel export

Send traces to any OTLP-compatible backend (Langfuse, Jaeger, Datadog, Grafana Tempo):

```yaml
# gatelane.config.yaml
export:
  otlp_endpoint: https://cloud.langfuse.com/api/public/otel
  otlp_headers:
    Authorization: "Basic <base64(publicKey:secretKey)>"
```

No vendor SDK needed — standard OpenTelemetry with GenAI semantic conventions.

## Threat model scope (v1)

| Source | v1 coverage |
|---|---|
| [OWASP Top 10 for Agentic Applications (ASI01–ASI10)](https://genai.owasp.org/) | Full |
| [MITRE ATLAS (v5.4.0, Feb 2026)](https://atlas.mitre.org/) | 16 tactics, 84 techniques, key sub-techniques |
| [OWASP LLM Top 10 (2026)](https://genai.owasp.org/) | Full |
| [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) | 12 risk categories |
| Taiwan AI Basic Act (2025/12/23) | v2 scope — compliance mode after v1 ships |

## Deploy to Cloudflare

The Worker is only needed for `gatelane snapshot` (capturing production traffic). Scan and eval work fully local.

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create gatelane
pnpm exec wrangler r2 bucket create gatelane-captures
pnpm exec wrangler kv namespace create GATELANE_KV
# paste the returned ids into wrangler.toml

pnpm run deploy
```

## Development

```bash
pnpm install          # install all dependencies
pnpm dev              # start Worker dev server (localhost:8787)
pnpm typecheck        # run TypeScript type checking (tsc -b)
pnpm lint             # run ESLint
pnpm test             # run tests (vitest)
```

### Packages

| Package | Description |
|---|---|
| `@lanefoundry/gatelane-cli` | CLI (`gatelane` command) — scan, eval, run, snapshot, init |
| `@lanefoundry/gatelane-engine` | Engine: LLM callers (8 providers), multi-turn replay, judge, compare, sign, evaluate, red team, OTel export |
| `@lanefoundry/gatelane-sdk` | SDK: capture, dataset, gate, storage (fs / http), Turn type |
| `gatelane-sdk` (Python) | Python SDK: capture, providers, storage, types |
| `@gatelane/mode-red-team` | Attack vectors (4 categories, 20 vectors), runner, report |
| `@gatelane/mode-backtest` | Backtest flow (freeze → replay → compare → gate) |
| `@lanefoundry/source-prod-slice` | Production slice: canary orchestrator, signed reports, audit export |

## Documentation

- [Positioning](docs/positioning.md) — the pre-production gate wedge
- [Roadmap](docs/roadmap.md) — demo target, v0.2 and v1.0 plans
- [Threat model](docs/threat-model.md) — OWASP / MITRE / NIST mapping
- [Attack library](docs/attack-library.md) — attack vectors reference
- [Architecture](docs/architecture.md) — system architecture, data flow
- [Distribution](docs/distribution.md) — npm / PyPI / Docker / package managers
- [SDK parity](docs/sdk-parity.md) — TypeScript / Python feature parity

## Full lifecycle

gatelane covers pre-deploy, deploy, and post-deploy:

```
Pre-deploy    scan → eval → pass/block           ✅ v0.1
Deploy        canary (10% → observe → promote)   🔜 v0.2
Post-deploy   monitor → alert → auto-re-scan     🔜 v0.2
```

v0.2 adds production monitoring — the same engine that runs pre-deploy scan/eval also monitors live traffic: quality regression alerts, attack detection on production traces, cost/latency anomaly detection, judge-drift alerts. See [roadmap](docs/roadmap.md) for details.

## What this is NOT

- **Not a general LLM gateway.** Use OpenRouter / LiteLLM for routing.
- **Not a workflow control plane.** The gate runs **on top of** whichever runtime you use.
- **Not a hosted service.** Self-host on your Cloudflare account, or run fully local without a Worker.

## License

Apache 2.0.

## Related

- [lanefoundry/groundlane](https://github.com/lanefoundry/groundlane) — trusted content access layer
- [lanefoundry/looplane](https://github.com/lanefoundry/looplane) — coding agent iteration loop

<div align="center">

# gatelane

**The promotion gate for AI agents — so the next Rehberger demo doesn't ship.**
Red-team payloads + production traces, frozen, replayed, signed into a promote-or-rollback decision.

[![CI](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml/badge.svg)](https://github.com/lanefoundry/gatelane/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early_preview-orange.svg)

[Why now](#why-now--attacks-on-ai-agents-ship-every-week) · [Threat model](#threat-model) · [Dataset sources](#dataset-sources) · [Quick start](#quick-start) · [Deploy](#deploy-to-cloudflare) · [Docs](#documentation) · [Roadmap](docs/roadmap.md)

[English](README.md) · [繁體中文](README.zh-TW.md)

</div>

gatelane is the third product in the [lanefoundry](https://github.com/lanefoundry) *-lane family. It ships a single promotion gate that takes any candidate — a new model, a new prompt, a new agent routing config, a new skill version — and replays it against a frozen dataset of attacks and production traces. The result is a signed decision: `promote`, `rollback`, or `hold_for_review`. CI/CD consumes the decision directly.

- [groundlane](https://github.com/lanefoundry/groundlane) — trusted content access layer for AI agents
- [looplane](https://github.com/lanefoundry/looplane) — coding agent iteration loop
- **gatelane** — pre-production safety + eval gate

> [!IMPORTANT]
> gatelane is an early preview (`0.0.0-dev`). 5–6 week demo target, first demo target is looplane (in-house). Threat model, capture SDK, and promotion primitive are still being designed. Do not deploy in production; expect breaking changes weekly.

## Why now — attacks on AI agents ship every week

Every week in August 2026, a new AI agent attack was disclosed in production. The pattern is consistent: an attacker wraps an external input — a webpage, a ZIP, an MCP response, an llms.txt file, an eval result, a persistent memory write — and turns it into a tool call, a credential exfiltration, or a remote code execution. The vendor's own commissioned eval said the success rate was 0%. The targeted attack chain still ships at 60–80%.

| Date | Target | Attack class | Where it bit |
|---|---|---|---|
| 2026-08-16 | agenticseek | Unauthenticated RCE | [series post](https://quidproquo.cc/posts/daily/2026-08-16-security-agenticseek-unauthenticated-rce) |
| 2026-08-16 | deadbugz | MCP supply chain | [series post](https://quidproquo.cc/posts/daily/2026-08-16-security-deadbugz-mcp-supply-chain) |
| 2026-08-17 | corebreak | Dispatch-layer bypass | [series post](https://quidproquo.cc/posts/daily/2026-08-17-security-corebreak-dispatch-layer-bypass) |
| 2026-08-18 | Flowise | Custom MCP command injection | [series post](https://quidproquo.cc/posts/daily/2026-08-18-security-flowise-custom-mcp-command-injection) |
| 2026-08-19 | Multiple agents | Persistent memory "mind virus" propagation | [series post](https://quidproquo.cc/posts/daily/2026-08-19-security-ai-mind-virus-persistent-memory-propagation) |
| 2026-08-20 | Copilot | One-click exfiltration (Cosnitch) | [series post](https://quidproquo.cc/posts/daily/2026-08-20-security-copilot-cosnitch-one-click-exfiltration) |
| 2026-08-21 | Splunk | MCP server toolkit RCE | [series post](https://quidproquo.cc/posts/daily/2026-08-21-security-splunk-mcp-server-toolkit-rce) |
| 2026-08-22 | Grok | Cryptographic context injection | [series post](https://quidproquo.cc/posts/daily/2026-08-22-security-grok-cryptographic-context-injection) |
| 2026-08-23 | Omnigent | Agent bundle RCE | [series post](https://quidproquo.cc/posts/daily/2026-08-23-security-omnigent-agent-bundle-rce) |
| 2026-08-24 | Xinference | Eval-injection RCE | [series post](https://quidproquo.cc/posts/daily/2026-08-24-security-xinference-eval-injection-rce) |
| 2026-08-25 | Mythos-5 | Agent social engineering | [series post](https://quidproquo.cc/posts/daily/2026-08-25-security-aisi-mythos5-agent-social-engineering) |
| 2026-08-26 | Ollama | DNS rebinding → model poisoning | [series post](https://quidproquo.cc/posts/daily/2026-08-26-security-nemoclaw-ollama-dns-rebinding-model-poisoning) |
| 2026-08-27 | LangGraph | Checkpointer post-injection RCE | [series post](https://quidproquo.cc/posts/daily/2026-08-27-security-langgraph-checkpointer-post-injection-rce) |
| 2026-08-28 | OpenAI / Hugging Face | Agent escape | [series post](https://quidproquo.cc/posts/daily/2026-08-28-security-openai-hugging-face-agent-escape) |
| 2026-08-29 | Fortune 500 readers | llms.txt supply chain | [series post](https://quidproquo.cc/posts/daily/2026-08-29-security-llmstxt-supply-chain) |
| 2026-08-30 | Claude Code (Auto Mode) | Module-shadowing RCE, 60–80% success vs vendor's "0%" eval | [series post](https://quidproquo.cc/posts/daily/2026-08-30-security-claude-code-automode-module-shadowing) |

(Full series: [AI Security Alert](https://quidproquo.cc/series/ai-security-alert/), 16 posts as of 2026-08-30.)

The buyer checklist exists. OWASP Top 10 for Agentic Applications (ASI01–ASI10) was published 9 Dec 2025. MITRE ATLAS v5.4.0 (Feb 2026) covers 16 tactics, 84 techniques. Eight incumbent cybersecurity acquisitions in 12 months: Lakera → Check Point, Protect AI → Palo Alto, CalypsoAI → F5, Prompt Security → SentinelOne, Aim Security → Cato, Apex Security → Tenable, SPLX → Zscaler. The OSS observability stack is consolidating too: WhyLabs → Apple, Helicone → Mintlify, Portkey → PANW, Langfuse → ClickHouse.
**The piece nobody ships is the join: take the attacks that ship every week (and the production traces the agent almost shipped them through), freeze them, replay every candidate — model, prompt, skill, agent config, tool schema, MCP server, eval dataset, KB corpus, memory backend, guardrail — against them, and produce a signed promote / rollback decision CI/CD can act on.** That is gatelane.

## Dataset sources

gatelane is one product with one verb — `promote(candidate, dataset, policy) → signed decision`. The dataset is pluggable. Three source variants feed the same gate:

### Red-team dataset

Curated attacks mapped to [OWASP Top 10 for Agentic Applications (ASI01–ASI10)](https://genai.owasp.org/) and [MITRE ATLAS v5.4.0](https://atlas.mitre.org/). Used to find vulnerabilities in a new agent and to verify a patch holds.

```text
attack payload → agent response → judge verdicts
                                       ↓
                            vulnerability record
                            + patch recommendation
```

The attack library ships with 50+ prompt injection vectors across direct prompt injection, indirect injection via tools, chain attacks, context window flood, memory poisoning, and tool abuse. Integrates with [garak](https://github.com/NVIDIA/garak) (NVIDIA), [PyRIT](https://github.com/Azure/PyRIT) (Microsoft), and [Promptfoo](https://github.com/promptfoo/promptfoo) (OpenAI).

### Production slice

A frozen slice of production traffic captured by the agent's normal calls. Used to gate routine model / prompt upgrades.

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

### Compliance dataset

Curated cases mapped to [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence), Taiwan AI Basic Act, EU AI Act, and sectoral overlays. Used for CISO / regulator sign-off. (v2 scope; ships after v1.)

```text
compliance cases → replay against target
                        ↓
                 per-case verdict
                        ↓
            signed compliance report
            (mapped to clauses per regime)
```

## Threat model

### OWASP Top 10 for Agentic Applications — gatelane coverage

| ASI | Name | v1 attacks | gatelane role |
|---|---|---|---|
| **ASI01** | Agent Goal Hijack | Crescendo + TAP multi-turn orchestrators; direct prompt injection | Red-team dataset source — payload → response → judge verdict |
| **ASI02** | Tool Misuse & Exploitation | Tool abuse, file delete, exec, exfil; indirect injection via tool results | Red-team dataset source — per-tool attack catalog |
| **ASI03** | Agent Identity & Privilege Abuse | MCP scope-expansion; non-human identity claims | Red-team dataset source + candidate enumeration via `provider-tool-routing` |
| **ASI04** | Agentic Supply Chain Compromise | Prompt-template injection via skill registry; skill version downgrade | Red-team dataset source — skill registry mutation tests |
| **ASI05** | Unexpected Code Execution | Coding-agent-specific payloads (TrojAI Mar 2026 categories) | Red-team dataset source — primary attack family for the looplane demo |
| **ASI06** | Memory & Context Poisoning | Long-context window-flood; memory write attacks | Red-team dataset source — context-flood probes |
| **ASI07** | Inter-Agent Communication | A2A handoff payloads (when A2A adapter is live) | Partial v1 (multi-agent deferred) |
| **ASI08** | Cascading Failures | High-load / loop-trigger chains | Red-team dataset source + production-slice replay |
| **ASI09** | Human–Agent Trust | Approval-gate bypass attempts | Partial v1 (deferred to v0.2) |
| **ASI10** | Rogue Agents | Multi-agent collusion scenarios | Partial v1 (deferred to v0.2) |

### MITRE ATLAS v5.4.0 — mapping to gatelane attacks

ATLAS v5.4.0 covers 16 tactics across the ML lifecycle. gatelane's red-team dataset source maps directly into ATLAS techniques:

| ATLAS tactic | gatelane attack family |
|---|---|
| Reconnaissance (AML.TA0001) | Target enumeration via provider registry + MCP discovery |
| Resource Development (AML.TA0002) | Attack library build (garak / PyRIT / Promptfoo) |
| Initial Access (AML.TA0003) | Direct prompt injection + indirect via tool results |
| ML Model Access (AML.TA0004) | Probe-based model fingerprinting |
| Execution (AML.TA0005) | Tool misuse + code execution (ASI05) |
| Persistence (AML.TA0006) | Memory write + skill registry mutation (ASI04, ASI06) |
| Defense Evasion (AML.TA0007) | Crescendo + TAP multi-turn orchestrators |
| Discovery (AML.TA0008) | Tool/MCP enumeration |
| Collection (AML.TA0009) | Data exfiltration via tool abuse (ASI02) |
| ML Attack Staging (AML.TA0010) | Attack chain composition across families |
| Exfiltration (AML.TA0011) | Tool abuse + indirect injection |
| Impact (AML.TA0012) | Goal hijack success (ASI01) |

### Attack families shipped in v1

| Family | Examples | Primary ASI / ATLAS |
|---|---|---|
| **Direct prompt injection** | "ignore previous instructions", roleplay overrides, encoding bypass | ASI01 / Initial Access |
| **Indirect injection via tool results** | Malicious content in search/reader/MCP outputs | ASI02 / Initial Access |
| **Chain attacks** | Crescendo, TAP, sequential escalation | ASI01 / Defense Evasion |
| **Context window flood** | Memory exhaustion; long-context override | ASI06 / Persistence |
| **Memory poisoning** | Long-term memory write attacks | ASI06 / Persistence |
| **Tool abuse** | File delete, exec, exfil, scope expansion | ASI02 / Execution, Exfiltration |
| **Approval-gate bypass** | Trust exploitation, signature forgery | ASI09 / Defense Evasion |
| **Skill registry mutation** | Version downgrade, prompt-template injection | ASI04 / Persistence |
| **Code execution (coding-agent)** | TrojAI Mar 2026 categories; eval-based escapes | ASI05 / Execution |

### NIST AI 600-1 + OWASP LLM Top 10 (2026) + Taiwan AI Basic Act

| Source | v1 coverage |
|---|---|
| [OWASP Top 10 for Agentic Applications (ASI01–ASI10)](https://genai.owasp.org/) | Full |
| [MITRE ATLAS (v5.4.0, Feb 2026)](https://atlas.mitre.org/) | 16 tactics, 84 techniques, key sub-techniques |
| [OWASP LLM Top 10 (2026)](https://genai.owasp.org/) | Full |
| [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) | 12 risk categories |
| Taiwan AI Basic Act (2025/12/23) | v2 scope — compliance dataset source after v1 ships |

## Why gatelane, not the alternatives

| Need | Alternative | Why gatelane instead |
|---|---|---|
| LLM gateway / routing | OpenRouter ($1.3B), LiteLLM (28k★), Bifrost (4k★), Cloudflare AI Gateway | gatelane is not a gateway. Use one of these. gatelane's capture SDK reads whatever the agent called. |
| LLM APM / tracing | Datadog, New Relic, Honeycomb | gatelane is not an APM. gatelane's audit log records the events that matter for promotion; APM records everything. |
| LLM eval / dataset | LangSmith, Braintrust, Arize, DeepEval, Vellum | These are eval runners. gatelane's promotion gate is what happens **after** the eval. |
| Red team / attack library | Mindgard, Lakera (Check Point), Pillar, Straiker, CyCraft, Noma | These compete on attack surface coverage. gatelane's red-team dataset source is intentionally smaller; the value is closing the loop with the production-slice source, not attacking broader. |
| Workflow control plane | Temporal, Inngest, LangGraph, Cloudflare Workflows | gatelane is not a workflow runtime. The promotion gate runs **on top of** whichever runtime you use. |

gatelane is **one primitive the rest of the market does not ship**: promotion-on-backtest-delta, with red-team and compliance dataset sources plugging into the same gate.

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

One-line integration on the agent side:

```typescript
import { capture } from "@lanefoundry/gatelane-sdk";

const response = await capture({
  prompt: [{ role: "user", content: userInput }],
  model: "gpt-4o",
  metadata: { traceId: "...", agentVersion: "..." },
}, async () => {
  return await openai.chat.completions.create({ /* ... */ });
});
// response is the original OpenAI response
// gatelane now has: prompt, response, model, cost, latency, trace
```

### Run a gate against red-team attacks

```bash
pnpm gatelane gate \
  --dataset-source redteam \
  --target http://localhost:3000/agent \
  --attack-library direct-injection,indirect-via-tool,chain \
  --report report.json
```

Output: `report.json` with successful attack payloads, agent responses, evidence, and per-vulnerability patch recommendations.

### Freeze a production slice and gate against it

```bash
# 1. Freeze last 7 days of production traffic into an immutable dataset
pnpm gatelane freeze-slice \
  --window 7d \
  --output dataset.jsonl

# 2. Run the gate — replay the frozen prod-slice dataset against one or more
#    candidates, then sign a promote / rollback decision.
#    A candidate can be any component swap in the agent's context.
pnpm gatelane gate \
  --dataset-source prod \
  --dataset dataset.jsonl \
  --baseline model:gpt-4o \
  --candidate model:gpt-5 \
  --threshold 0.02 \
  --gate github-actions

# Multiple candidate types in one gate run. Each carries its own SHA
# in the signed PromotionReport:
#   --candidate model:gpt-5
#   --candidate prompt:system-v2
#   --candidate skill:citation-extractor@1.3.0
#   --candidate config:agent-routing-experimental
#   --candidate tool:mcp-server-foo@1.2.0
#   --candidate eval:xinference-suite-v3
#   --candidate kb:groundlane-corpus-q3
#   --candidate memory:persistence-backend
#   --candidate dispatcher:corebreak-rules
#   --candidate guardrail:input-filter-v2
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

Run the gate against the **red-team dataset** before each release. Run it again after the patch against the same red-team dataset to verify the new version resists those payloads, then against a **production slice** to verify the patch doesn't regress on quality.

### ML / platform team at a company shipping LLM features

> "Can we ship a new model version without watching the comparison view all day?"

Run the gate against a **production slice** on every PR that touches the model config. The promotion gate routes to canary or rolls back automatically.

### Coding agent team

> "What if my coding agent is hijacked via prompt injection? How do I know when I've fixed it?"

Run the gate against a **red-team dataset** with coding-agent-specific attack vectors (tool abuse, indirect injection via code execution). After patching, re-run the gate against the **same red-team dataset** to verify the patch holds.

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

## Repo layout

```text
gatelane/
├── README.md
├── docs/
│   ├── positioning.md          — wedge, market consolidation, who buys
│   ├── roadmap.md              — 5-6 week demo plan, v0.2 / v1.0
│   ├── strategic-record.md     — why we pivoted from Agent Platform
│   ├── threat-model.md         — (planned) OWASP / MITRE / NIST mapping
│   ├── attack-library.md       — (planned) 50+ attack vectors design
│   └── architecture.md         — (planned) shared engine internals
├── packages/
│   ├── engine/                 — capture SDK + dataset + replay + compare + audit log + promotion primitive
│   ├── source-redteam/         — red-team dataset source: garak / PyRIT / Promptfoo integration
│   ├── source-prod-slice/      — production-slice dataset source: capture SDK feed + freeze
│   ├── source-compliance/      — compliance dataset source (v2)
│   └── shared/                 — common types, D1 schema, models
├── apps/
│   ├── worker/                 — Cloudflare Worker (capture endpoint + gate API)
│   └── dashboard/              — gate report + audit log UI
├── tests/
│   ├── unit/
│   ├── integration/            — 4 coding agents head-to-head
│   └── e2e/                    — full flow E2E
├── package.json                — pnpm workspace root
├── pnpm-workspace.yaml
└── LICENSE                     — Apache 2.0
```

## Documentation

- [Why gatelane](docs/positioning.md) — the promotion-on-backtest-delta wedge
- [Roadmap](docs/roadmap.md) — 5–6 week demo target, v0.2 and v1.0 plans
- [Strategic record](docs/strategic-record.md) — why we pivoted from Agent Platform Workflow Control Plane
- *Threat model* (planned, week 2)
- *Attack library design* (planned, week 3)

## Status

| Item | Status |
|---|---|
| Repo + README + positioning | ✅ done (2026-08-30) |
| Capture SDK (1-line integration) | 🟡 in design |
| Shared engine (dataset / replay / compare) | 🟡 in design |
| Red-team dataset source (50+ attacks) | 🟡 planned (week 3-4) |
| Production-slice dataset source (promotion gate) | 🟡 planned (week 5-6) |
| Compliance dataset source (v2) | ⏳ planned |
| First demo target: looplane vulnerability report | ⏳ pending |
| First promotion report: gatelane validates looplane's own patch | ⏳ pending |
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
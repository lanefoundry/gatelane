# gatelane product scope

> v0.5 (2026-09-04)
> Records the product scope expansion from "red team + backtest" to "red team + blue team + eval" with Langfuse-grade tracing in the shared engine. Adds framework alignment: DeepEval, Promptfoo (eval); Garak, PyRIT, Mindgard (red team). Records frontend architecture decision: TanStack Start + Hono in single Worker. Supersedes the two-mode (Mode A / Mode B) framing used in earlier docs.

## Overview

gatelane is the pre-production safety, observability, and evaluation gate for AI agents. It provides three operational pillars — red team, blue team, and eval — on top of a shared engine with Langfuse-grade tracing.

**Tagline:** Red team. Blue team. Eval. One shared engine.

---

## 1. Three pillars

### 1.1 Red team (紅隊) — "can it be broken?"

Adversarial attack probes that test whether an AI agent can be compromised.

| Capability | Description |
|---|---|
| Attack probes | 50+ prompt injection vectors across 6 categories (direct injection, indirect via tools, chain attacks, context window flood, memory poisoning, tool abuse) |
| External framework integration | garak (NVIDIA), PyRIT (Microsoft), Promptfoo, Mindgard |
| Adversarial multi-turn testing | Multi-turn attack scenarios that simulate sustained adversarial pressure across conversation turns |
| Vulnerability reporting | Structured report with payload, agent response, evidence, and patch recommendation |

Package: `@gatelane/mode-red-team` (`packages/mode-red-team/`)

### 1.2 Blue team (藍隊) — "is production healthy?"

Defensive operations: observe production behavior, detect anomalies, verify patches through backtest, and gate promotions.

| Capability | Description |
|---|---|
| Anomaly detection | Detect quality degradation, behavioral drift, cost spikes, and latency increases from observed production data |
| Backtest | Freeze a time-window slice of production traffic, replay against a candidate model, compare scores against baseline |
| Promotion gate | If `Δ ≥ threshold`, promote to canary → 100%; else auto-rollback. Signed promotion report with full provenance |
| Regression verification | After a red team finding is patched, verify the fix didn't regress quality or re-expose attack surfaces |

Package: `@gatelane/mode-blue-team` (`packages/mode-blue-team/`)

Note: Observation and tracing capabilities live in the shared engine (section 2), not in the blue team package. The blue team package consumes traced data for anomaly detection, backtest, and promotion decisions.

### 1.3 Eval (評測) — "does it work correctly?"

Quality evaluation: structured scoring, automated scenario-based testing, and CI/CD integration.

#### Scoring metrics

| Metric | Description |
|---|---|
| Correctness | Is the answer right? Does the generated code compile and run? |
| Faithfulness | Did the agent follow instructions? |
| Relevance | Is the response on-topic? |
| Hallucination detection | Did the agent fabricate APIs, functions, or packages that don't exist? |
| Safety | Does the generated code contain vulnerabilities (SQL injection, XSS, command injection, etc.)? |
| Format compliance | Is the output in the expected format (JSON, code, structured output)? |
| Toxicity | Does the output contain harmful content? |
| Custom metrics | User-defined judge functions |

#### Testing modes

| Mode | Description |
|---|---|
| Single-turn eval | One prompt → one response → score |
| Multi-turn scenario testing | Simulate a complete task scenario; the agent executes through multiple turns including tool calls, file operations, code execution, and multi-step reasoning. Every step in the agent's full behavior chain is traced and scored. |
| Golden answer comparison | Compare agent output against a known-correct reference answer |
| Pairwise comparison | Model A vs Model B, which performs better on the same inputs |
| Edge case testing | Specifically test extreme or exceptional inputs |
| Assertion-based testing | Unit-test style: `expect(output).toContain(...)`, `expect(toolCalls).not.toInclude("rm -rf")` |

#### Automation

| Feature | Description |
|---|---|
| CI/CD integration | Trigger eval on PR; block merge if quality falls below threshold |
| Production → test cases | Automatically generate eval datasets from observed production traffic |
| Feature-completion trigger | When a feature is completed, automatically run the corresponding scenario tests |

Package: `@gatelane/mode-eval` (`packages/mode-eval/`)

---

## 2. Shared engine with Langfuse-grade tracing

The engine provides the shared infrastructure that all three pillars depend on. Its tracing capability must be aligned with Langfuse's observability model.

### 2.1 Why tracing is in the engine, not in blue team

Tracing is a cross-cutting concern. Every pillar needs it:

- Red team runs an attack → every step is traced
- Blue team runs a backtest → every step is traced
- Eval runs a scenario test → the agent's full behavior chain (tool calls, file ops, code execution) is traced

Tracing belongs in the shared engine so all pillars get it for free.

### 2.2 Tracing model (aligned with Langfuse)

The engine must support a three-level hierarchy:

```
Session (optional grouping of related traces)
  └── Trace (one complete task execution)
        ├── Span (a step within the trace)
        │     ├── Span (nested sub-step)
        │     └── Generation (an LLM call within this step)
        ├── Generation (a top-level LLM call)
        └── Span
              └── Generation
```

#### Core concepts

| Concept | Langfuse equivalent | Description |
|---|---|---|
| **Trace** | Trace | A complete unit of work (one red team attack, one backtest replay, one eval scenario run). Has a trace ID, start/end time, status, metadata, and user attribution. |
| **Span** | Span | A step within a trace. Supports nesting (parent-child). Captures: name, start/end time, input/output, metadata. Used for tool calls, file operations, code execution, reasoning steps. |
| **Generation** | Generation | A specific LLM call within a span or trace. Captures: model, prompt, completion, token counts (input/output/total), cost, latency, provider. This is what the current `capture` SDK records — it becomes one type of span. |
| **Session** | Session | Optional grouping of related traces (e.g., all eval runs for a single PR, all red team attacks in one sweep). |
| **Score** | Score | A numeric or categorical evaluation attached to a trace, span, or generation. Multiple scores per object. Supports both automated (judge model) and manual scoring. |
| **User** | User | Identity of the person or system that initiated the trace. |

#### What the current capture SDK becomes

The existing `capture()` function in the engine records a single LLM call. In the new model, this becomes a **Generation** — one node inside a larger trace. The current `CaptureRecord` D1 table evolves to support the trace/span/generation hierarchy.

### 2.3 Feature comparison: current vs target

| Feature | Current engine | Target (Langfuse-aligned) |
|---|---|---|
| Single LLM call recording | ✅ | ✅ (as Generation) |
| Trace (complete execution chain) | ❌ | ✅ |
| Span (nested steps within a trace) | ❌ | ✅ |
| Generation (LLM call with token stats) | Partial (no token breakdown) | ✅ |
| Parent-child relationships | ❌ | ✅ (trace → span → generation) |
| Session grouping | ❌ | ✅ |
| User attribution | ❌ | ✅ |
| Cost calculation (per-model pricing) | Partial | ✅ |
| Score attachment (on any trace/span/gen) | ❌ | ✅ |
| Tool call tracing | ❌ | ✅ (as spans) |
| File operation tracing | ❌ | ✅ (as spans) |
| Code execution tracing | ❌ | ✅ (as spans) |
| Real-time dashboard | Basic (6 pages) | ✅ (enhanced with trace viewer) |
| SDK integration (decorator / wrapper) | ❌ | ✅ |
| Dataset management | ✅ (freeze-slice) | ✅ (enhanced: from traces, not just captures) |
| Replay | ✅ | ✅ (enhanced: replay full traces, not just single calls) |
| Audit log | ✅ | ✅ |
| Promotion primitive | ✅ | ✅ |

### 2.4 Engine package exports (target)

```
packages/engine/
  ├── trace.ts          — createTrace, endTrace, getTrace
  ├── span.ts           — createSpan, endSpan (supports nesting)
  ├── generation.ts     — createGeneration (LLM call recording, was capture.ts)
  ├── session.ts        — createSession, getSession
  ├── score.ts          — attachScore (to trace/span/generation)
  ├── dataset.ts        — createDataset, freezeSlice (enhanced: from traces)
  ├── replay.ts         — replay (enhanced: full trace replay)
  ├── compare.ts        — compare
  ├── promotion.ts      — evaluatePromotion
  ├── audit-log.ts      — writeAuditLog
  └── index.ts          — re-exports
```

---

## 3. Eval framework alignment

gatelane draws from six external frameworks across its three pillars. Langfuse alignment (tracing) is covered in section 2. This section maps gatelane's eval and red team capabilities against DeepEval, Promptfoo, Garak, PyRIT, and Mindgard.

### 3.1 DeepEval alignment

DeepEval provides 50+ evaluation metrics, agent trajectory testing, and an `@observe` tracing decorator. gatelane's eval pillar targets feature parity with DeepEval's metric categories while adding production-grade tracing and cross-pillar workflows.

#### Metric coverage mapping

| DeepEval metric category | DeepEval metrics | gatelane equivalent | Pillar |
|---|---|---|---|
| **Custom (LLM-as-judge)** | G-Eval, DAG, Conversational G-Eval/DAG | Custom metrics (user-defined judge functions) | Eval |
| **AI Agent — trajectory** | Task Completion, Step Efficiency, Plan Adherence, Plan Quality | Multi-turn scenario testing (full agent behavior chain) | Eval |
| **AI Agent — component** | Tool Correctness, Argument Correctness | Assertion-based testing (`expect(toolCalls)...`) + tool call tracing (as spans) | Eval + Engine |
| **RAG** | Contextual Relevancy, Contextual Precision, Contextual Recall, Answer Relevancy, Faithfulness | Faithfulness, Relevance scoring metrics | Eval |
| **Multi-turn** | Knowledge Retention, Role Adherence, Conversation Completeness, Conversation Relevancy | Multi-turn scenario testing with per-turn scoring | Eval |
| **Safety** | Bias, Toxicity, Non-Advice, Misuse, PII Leakage, Role Violation | Safety scoring + red team attack probes (50+ vectors) | Eval + Red team |
| **Image** | Image metrics | v2 scope | — |
| **Others** | Hallucination, JSON Correctness, Summarization | Hallucination detection, Format compliance | Eval |

#### Feature mapping

| DeepEval feature | gatelane equivalent | Notes |
|---|---|---|
| `@observe` decorator (tracing) | Shared engine tracing (Langfuse-grade) | gatelane's tracing is in the engine, available to all pillars |
| `EvaluationDataset` + Golden test cases | Dataset management (freeze-slice from traces) | gatelane adds production traffic → test case generation |
| TypeScript SDK (Vitest integration) | `@gatelane/mode-eval` TypeScript package | Native TypeScript; no Python dependency |
| Python SDK (Pytest integration) | Out of scope (v1) | gatelane is TypeScript-first (Cloudflare Workers) |
| DeepTeam (red teaming) | `@gatelane/mode-red-team` (separate pillar) | gatelane separates red team as its own pillar with 50+ vectors |
| Confident AI platform (hosted dashboard) | Self-hosted dashboard (React + Vite) | gatelane runs on user's Cloudflare account |
| LangChain / LangGraph / OpenAI integrations | Provider-agnostic via engine tracing | Wrap any provider; trace as Generation spans |

### 3.2 Promptfoo alignment

Promptfoo provides deterministic and model-assisted assertions, red teaming, YAML-driven configuration, and CI/CD integration. gatelane's eval and red team pillars target feature parity with Promptfoo's assertion system while adding production observability and promotion gates.

#### Assertion coverage mapping

| Promptfoo assertion category | Promptfoo assertions | gatelane equivalent | Pillar |
|---|---|---|---|
| **Deterministic — exact** | equals, contains, regex, starts-with, icontains | Assertion-based testing | Eval |
| **Deterministic — format** | is-json, is-sql, is-xml, is-valid-openai-tools-call | Format compliance scoring | Eval |
| **Deterministic — safety** | is-refusal | Safety scoring + red team probes | Eval + Red team |
| **Deterministic — NLP** | rouge-n, bleu, gleu, levenshtein, meteor | NLP metrics (target) | Eval |
| **Deterministic — operational** | latency, cost, perplexity | Traced via engine Generation spans (latency, token counts, cost) | Engine |
| **Deterministic — agent** | tool-used, tool-args-match, tool-sequence, step-count | Assertion-based testing on traced tool call spans | Eval + Engine |
| **Deterministic — guardrails** | guardrails (custom validation functions) | Custom metrics (user-defined judge functions) | Eval |
| **Model-assisted — quality** | similar, llm-rubric, g-eval, answer-relevance, factuality, select-best | Correctness, Faithfulness, Relevance scoring | Eval |
| **Model-assisted — RAG** | context-faithfulness, context-recall, context-relevance | Faithfulness, Relevance scoring | Eval |
| **Model-assisted — conversation** | conversation-relevance | Multi-turn scenario testing with per-turn scoring | Eval |
| **Model-assisted — agent** | trajectory:goal-success | Multi-turn scenario testing (task completion) | Eval |
| **Model-assisted — moderation** | classifier, moderation | Safety scoring, Toxicity | Eval |

#### Feature mapping

| Promptfoo feature | gatelane equivalent | Notes |
|---|---|---|
| YAML config (`promptfooconfig.yaml`) | Programmatic TypeScript API | gatelane is code-first; YAML config is v2 scope |
| Matrix comparison view | Pairwise comparison + dashboard | Compare Model A vs Model B on same inputs |
| Red teaming (prompt injection, jailbreaking, PII, tool vuln, data exfiltration) | `@gatelane/mode-red-team` (50+ vectors, 6 categories) | gatelane's red team is a dedicated pillar, not a sub-feature |
| CI/CD GitHub Action | CI/CD integration (PR trigger, merge gate) | gatelane adds promotion gate with signed provenance |
| 50+ LLM providers | Provider-agnostic via engine tracing | Any provider that accepts prompt/completion |
| Caching + concurrency | Engine-level caching + Cloudflare Workers concurrency | Leverages edge runtime |
| Custom providers | Custom metrics (judge functions) | User-defined evaluation logic |

### 3.3 Red team framework alignment (Garak, PyRIT, Mindgard)

These three frameworks focus on adversarial AI security testing. gatelane's red team pillar targets comparable attack coverage while integrating with blue team and eval pillars for end-to-end vulnerability lifecycle management.

#### Attack vector coverage

| Attack category | Garak | PyRIT | Mindgard | gatelane Red team |
|---|---|---|---|---|
| Prompt injection (direct) | ✅ promptinject | ✅ direct injection | ✅ | ✅ category 1 |
| Prompt injection (indirect / via tools) | — | ✅ XPIA orchestrator | ✅ plugin compromise | ✅ category 2 |
| Jailbreaking | ✅ DAN, encoding | ✅ Skeleton Key, many-shot | ✅ | ✅ category 1 |
| Chain attacks / multi-turn | ✅ atkgen (adaptive) | ✅ Crescendo, TAP, RedTeaming | ✅ agentic multi-turn | ✅ category 3 |
| Context window flood | — | — | — | ✅ category 4 |
| Memory poisoning | — | — | — | ✅ category 5 |
| Tool abuse | — | Partial | ✅ | ✅ category 6 |
| Data exfiltration | — | ✅ | ✅ | ✅ |
| Hallucination exploit | ✅ snowball, package | — | ✅ | Via eval pillar |
| Encoding bypass (Base64, ROT13, etc.) | ✅ encoding probes | ✅ converters (chainable) | — | v2 scope |
| Multi-modal (image, audio, video) | — | ✅ cross-modal | ✅ CV, audio | v2 scope |
| Model extraction / theft | — | — | ✅ | Out of scope |
| Toxicity / harmful content | ✅ realtoxicityprompts | ✅ jailbreak templates | ✅ | Via eval pillar (safety scoring) |
| Guardrail bypass | Partial | Partial (converters) | ✅ GuardBuster | v2 scope |
| XSS / code injection | ✅ xss probes | — | — | Via eval pillar (safety scoring) |

#### Architecture comparison

| Component | Garak | PyRIT | Mindgard | gatelane |
|---|---|---|---|---|
| **Attack library** | 50+ probe modules | Templates + 15+ harm categories | Continuously updated (proprietary) | 50+ vectors, 6 categories |
| **Orchestration** | Harness (probewise) | Orchestrators (Crescendo, TAP, XPIA) | Agentic recon + automated | Attack runner |
| **Payload transform** | Buffs / Fuzzes | Converters (chainable pipeline) | GuardBuster | v2 scope |
| **Scoring / detection** | 28 detector types | Scorers (LLM-as-judge, binary, Likert) | Built-in analysis | Vulnerability report + eval pillar |
| **Target adapters** | 23 generator backends | OpenAI, Azure, HF, HTTP, Playwright | API endpoint only | Provider-agnostic via engine |
| **Multi-turn** | atkgen (fine-tuned GPT-2) | Crescendo, TAP (attacker LLM feedback) | Agentic multi-turn | Adversarial multi-turn testing |
| **Persistence** | JSONL logs | SQLite / Azure SQL (cross-session) | SaaS platform | D1 database + trace history |
| **CI/CD** | CLI-friendly (JSONL output) | `pyrit_scan` CLI | GitHub Actions | CI/CD integration (cross-pillar) |
| **Compliance mapping** | — | — | MITRE ATLAS, OWASP LLM Top 10 | ATLAS, OWASP Agentic/LLM, NIST |
| **Deployment** | Open source (Apache 2.0) | Open source (MIT) | SaaS (enterprise) | Self-hosted (Cloudflare Workers) |

#### Feature mapping

| Framework feature | gatelane equivalent | Notes |
|---|---|---|
| **Garak** probes (50+ modules, nmap-style) | Attack probes (50+ vectors, 6 categories) | Similar scale; gatelane categorizes by attack surface |
| **Garak** detectors (28 types) | Vulnerability report + eval scoring | gatelane separates detection (red) from quality scoring (eval) |
| **Garak** atkgen (adaptive attacker LLM) | Adversarial multi-turn testing | gatelane plans multi-turn with full agent behavior chain |
| **Garak** HTML report | Structured vulnerability report | gatelane adds patch recommendations + trace provenance |
| **PyRIT** Crescendo orchestrator | Adversarial multi-turn testing | Gradual escalation strategy; gatelane targets equivalent |
| **PyRIT** TAP (tree of attacks with pruning) | v2 scope | Parallel multi-path attack exploration |
| **PyRIT** converters (chainable transforms) | v2 scope | Encoding bypass, cross-modal transforms |
| **PyRIT** persistent memory (cross-session) | D1 database + engine tracing | Attack history with full trace provenance |
| **PyRIT** multi-modal attacks | v2 scope | gatelane v1 focuses on text/LLM agents |
| **PyRIT** scorers (LLM-as-judge, Content Safety) | Eval pillar scoring metrics | gatelane separates scoring into eval pillar |
| **Mindgard** DAST-AI (runtime testing) | Red team probes + blue team anomaly detection | gatelane splits across two pillars |
| **Mindgard** agentic recon (attack surface mapping) | v2 scope | Automated discovery of guardrails, system prompts, tools |
| **Mindgard** continuous security testing | Blue team anomaly detection + CI/CD | gatelane's blue team monitors production continuously |
| **Mindgard** MITRE ATLAS Adviser | Threat model coverage (section 7) | gatelane maps ATLAS + OWASP + NIST |
| **Mindgard** compliance reports (SOC 2, GDPR) | Audit log + signed promotion reports | gatelane focuses on deployment provenance |
| **Mindgard** Burp Suite integration | Out of scope | Traditional AppSec bridge |
| **Mindgard** shadow AI discovery | Out of scope | Enterprise-specific concern |

### 3.4 Differentiation: what gatelane adds

These capabilities are not present in DeepEval, Promptfoo, Langfuse, Garak, PyRIT, or Mindgard individually:

| Capability | Description | Why it matters |
|---|---|---|
| **Three-pillar integration** | Red team + blue team + eval on one shared engine | No context switching between attack testing, production defense, and quality eval |
| **Production → eval pipeline** | Freeze production traffic slice → generate eval dataset → run scenario tests → promote or rollback | Closes the loop between production data and quality gates |
| **Promotion gate with provenance** | If `Δ ≥ threshold`, auto-promote; else auto-rollback. Signed report with full trace provenance | Auditable, automated deployment decisions |
| **Anomaly detection on traced data** | Detect quality degradation, behavioral drift, cost spikes from production traces | Proactive defense, not just reactive testing |
| **Cross-pillar regression verification** | After red team finding → patch → eval test → blue team production verify | End-to-end vulnerability lifecycle |
| **Edge-native (Cloudflare Workers)** | Entire stack runs on user's Cloudflare account | No data leaves user's infrastructure; D1 + R2 storage |

---

## 4. Package structure

```
gatelane/
  ├── packages/
  │     ├── shared/           — Common types, D1 schema
  │     ├── engine/           — Shared engine: tracing (Langfuse-grade), dataset,
  │     │                       replay, compare, promotion, audit log
  │     ├── mode-red-team/    — Red team: attack vectors, runner, report
  │     ├── mode-blue-team/   — Blue team: anomaly detection, backtest, promotion gate
  │     └── mode-eval/        — Eval: scoring metrics, scenario testing, automation
  ├── apps/
  │     ├── worker/           — Single Cloudflare Worker deployment
  │     │                       ├── Hono API (/v1/*) — public REST endpoints
  │     │                       └── TanStack Start — SSR frontend + server functions
  │     └── dashboard/        — TanStack Start app (Router + Query + SSR)
  └── tests/
```

### 4.1 Frontend architecture

**TanStack Start (frontend) + Hono (API), single Worker deployment.**

```
Request
  │
  ├── /v1/*  ──→  Hono (REST API, public)
  │                 └── D1, R2, KV bindings
  │
  └── /*     ──→  TanStack Start (SSR + client)
                    ├── TanStack Router (file-based, type-safe)
                    ├── TanStack Query (data fetching, already in use)
                    └── Server functions (dashboard-specific queries, direct D1 access)
```

| Concern | Technology | Rationale |
|---|---|---|
| Public API (`/v1/*`) | Hono | Already built; REST-style; portable (Workers / Deno / Node) |
| Frontend routing | TanStack Router | Type-safe; file-based; replaces hand-rolled hash router |
| Data fetching | TanStack Query | Already in use (v5); cache + dedup |
| SSR + server functions | TanStack Start (Vinxi → Nitro) | SSR streaming; direct D1 access for dashboard queries |
| Deployment | Single Cloudflare Worker | Nitro `cloudflare-module` preset; Hono mounted as sub-app for `/v1/*` |

#### Migration from current setup

| Current | Target |
|---|---|
| React 18 + Vite SPA | TanStack Start (React 19 + SSR) |
| Hand-rolled hash routing (`switch` on `location.hash`) | TanStack Router (file-based) |
| `@tanstack/react-query` v5 | Kept as-is |
| Separate dashboard + worker deployments | Single Worker deployment |
| `src/lib/api.ts` → `fetch(VITE_API_URL)` | Server functions (direct D1) + Hono API (REST) |

### 4.2 npm package names

| Package | npm name | Description |
|---|---|---|
| `packages/shared` | `@gatelane/shared` | Common types, D1 schema |
| `packages/engine` | `@gatelane/engine` | Shared engine with Langfuse-grade tracing |
| `packages/mode-red-team` | `@gatelane/mode-red-team` | Red team: adversarial attack probes |
| `packages/mode-blue-team` | `@gatelane/mode-blue-team` | Blue team: observe, backtest, promote |
| `packages/mode-eval` | `@gatelane/mode-eval` | Eval: scoring, scenario testing, CI/CD |

---

## 5. Naming changes

### Removed: Mode A / Mode B

The earlier documentation used "Mode A" and "Mode B" as abstract labels for the two operating modes. These are removed entirely. The three pillars use descriptive names:

| Old | New |
|---|---|
| Mode A (red team) | Red team (紅隊) |
| Mode B (backtest) | Blue team (藍隊) |
| — | Eval (評測) |

### Renamed: mode-backtest → mode-blue-team

The `mode-backtest` package is renamed to `mode-blue-team`. Backtest remains a capability within the blue team pillar, alongside anomaly detection and the promotion gate.

### Rationale

1. **Red team without blue team is asymmetric.** In security, red team (attack) and blue team (defense) are a pair. Having "red team" and "backtest" breaks the metaphor.
2. **Mode A / Mode B are meaningless labels.** They carry no semantic information and require a lookup table. The `docs/architecture.md` had them swapped, proving they're easy to confuse.
3. **Eval is a distinct pillar.** Quality evaluation, scenario testing, and CI/CD integration don't fit neatly into either red team (adversarial) or blue team (production defense). They deserve their own space.
4. **Tracing is a shared concern.** Observation/tracing belongs in the engine, not in any single pillar. Every pillar needs it.

---

## 6. Relationship between pillars

```
                          ┌─────────────────────┐
                          │    Shared Engine     │
                          │  (Langfuse-grade     │
                          │   tracing + core     │
                          │   primitives)        │
                          └──────────┬──────────┘
                                     │
                 ┌───────────────────┼───────────────────┐
                 │                   │                   │
          ┌──────┴──────┐    ┌──────┴──────┐    ┌──────┴──────┐
          │  Red Team   │    │  Blue Team  │    │    Eval     │
          │  (攻擊)     │    │  (防禦)     │    │  (品質)     │
          │             │    │             │    │             │
          │ • Attack    │    │ • Anomaly   │    │ • Scoring   │
          │   probes    │    │   detection │    │   metrics   │
          │ • Adversar. │    │ • Backtest  │    │ • Scenario  │
          │   multi-turn│    │ • Promotion │    │   testing   │
          │ • Vuln      │    │   gate      │    │ • CI/CD     │
          │   report    │    │ • Regression│    │   integration│
          │             │    │   verify    │    │ • Assertion  │
          └─────────────┘    └─────────────┘    └─────────────┘
```

### Cross-pillar workflows

| Workflow | Pillars involved | Description |
|---|---|---|
| Vulnerability → patch → verify | Red team → Eval → Blue team | Find a vulnerability (red), test the fix (eval), verify no regression on production traffic (blue) |
| Model upgrade | Blue team → Eval | Backtest the new model on frozen production slice (blue), run scenario tests on the new model (eval) |
| Feature ship | Eval → Blue team | Run scenario tests on the feature (eval), backtest to verify no regression (blue), promote or rollback (blue) |
| Security audit | Red team → Blue team | Run full attack sweep (red), verify all previous vulnerabilities are still patched (blue) |
| CI/CD gate | All three | PR triggers: red team attack check + eval scenario tests + blue team regression check. All must pass to merge. |

---

## 7. Threat model coverage by pillar

| Framework | Red team | Blue team | Eval |
|---|---|---|---|
| OWASP Agentic Top 10 (ASI01–ASI10) | Primary | Regression verification | Safety scoring |
| MITRE ATLAS v5.4.0 | Primary | Behavioral drift detection | — |
| OWASP LLM Top 10 (2026) | Primary | Regression verification | Correctness, hallucination |
| NIST AI 600-1 | Partial | Audit + provenance | Quality scoring |
| Taiwan AI Basic Act | v2 scope | v2 scope | v2 scope |

---

## 8. Implementation status and plan

| Item | Status | Pillar |
|---|---|---|
| Attack probes (50+ vectors, 6 categories) | ✅ done | Red team |
| Attack runner + report generator | ✅ done | Red team |
| Adversarial multi-turn testing | ✅ done | Red team |
| Single LLM call capture (basic) | ✅ done | Engine |
| Langfuse-grade tracing (trace/span/generation) | ✅ done | Engine |
| Session grouping | ✅ done | Engine |
| Score attachment | ✅ done | Engine |
| SDK integration (decorator/wrapper) | ❌ not started | Engine |
| Dataset freeze-slice | ✅ done | Engine |
| Replay + compare | ✅ done | Engine |
| Promotion primitive | ✅ done | Engine |
| Audit log | ✅ done | Engine |
| Anomaly detection | ✅ done | Blue team |
| Backtest orchestration | ✅ done (as mode-backtest) | Blue team |
| Promotion gate | ✅ done | Blue team |
| Scoring metrics (correctness via judge) | ✅ basic (custom judge) | Eval |
| Multi-turn scenario testing (full agent behavior) | ❌ not started | Eval |
| Golden answer comparison | ❌ not started | Eval |
| Pairwise comparison | ❌ not started | Eval |
| Edge case testing | ❌ not started | Eval |
| Assertion-based testing | ✅ done (6 operators) | Eval |
| CI/CD integration | ❌ not started | Eval |
| Production → test case generation | ❌ not started | Eval |
| Feature-completion trigger | ❌ not started | Eval |
| Dashboard (basic 6 pages) | ✅ done | Apps |
| Dashboard (trace viewer) | ❌ not started | Apps |
| Naming: Mode A/B → Red/Blue/Eval | ✅ done | All |
| Package rename: mode-backtest → mode-blue-team | ✅ done | Blue team |
| Package scaffold: mode-eval | ✅ done | Eval |

---

## References

- `docs/strategic-record.md` — strategic context, pivot history
- `docs/positioning.md` — market positioning, wedge analysis
- `docs/threat-model.md` — OWASP / MITRE / NIST mapping
- `docs/attack-library.md` — 50+ attack vectors reference
- `docs/architecture.md` — system architecture (to be updated for three-pillar model)
- `docs/roadmap.md` — demo plan (to be updated)
- [Langfuse docs](https://langfuse.com/docs) — tracing model reference
- [DeepEval docs](https://docs.confident-ai.com/) — eval framework reference
- [Promptfoo docs](https://www.promptfoo.dev/docs/) — assertion + red teaming framework reference

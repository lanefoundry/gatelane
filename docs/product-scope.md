# gatelane product scope

> v0.2 (2026-09-03)
> Records the product scope expansion from "red team + backtest" to "red team + blue team + eval" with Langfuse-grade tracing in the shared engine. Supersedes the two-mode (Mode A / Mode B) framing used in earlier docs.

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
| External framework integration | garak (NVIDIA), PyRIT (Microsoft), Promptfoo (OpenAI) |
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

## 3. Package structure

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
  │     ├── worker/           — Cloudflare Worker (Hono, API endpoints)
  │     └── dashboard/        — React + Vite (trace viewer, reports, promotions)
  └── tests/
```

### npm package names

| Package | npm name | Description |
|---|---|---|
| `packages/shared` | `@gatelane/shared` | Common types, D1 schema |
| `packages/engine` | `@gatelane/engine` | Shared engine with Langfuse-grade tracing |
| `packages/mode-red-team` | `@gatelane/mode-red-team` | Red team: adversarial attack probes |
| `packages/mode-blue-team` | `@gatelane/mode-blue-team` | Blue team: observe, backtest, promote |
| `packages/mode-eval` | `@gatelane/mode-eval` | Eval: scoring, scenario testing, CI/CD |

---

## 4. Naming changes

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

## 5. Relationship between pillars

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

## 6. Threat model coverage by pillar

| Framework | Red team | Blue team | Eval |
|---|---|---|---|
| OWASP Agentic Top 10 (ASI01–ASI10) | Primary | Regression verification | Safety scoring |
| MITRE ATLAS v5.4.0 | Primary | Behavioral drift detection | — |
| OWASP LLM Top 10 (2026) | Primary | Regression verification | Correctness, hallucination |
| NIST AI 600-1 | Partial | Audit + provenance | Quality scoring |
| Taiwan AI Basic Act | v2 scope | v2 scope | v2 scope |

---

## 7. Implementation status and plan

| Item | Status | Pillar |
|---|---|---|
| Attack probes (50+ vectors, 6 categories) | ✅ done | Red team |
| Attack runner + report generator | ✅ done | Red team |
| Adversarial multi-turn testing | ❌ not started | Red team |
| Single LLM call capture (basic) | ✅ done | Engine |
| Langfuse-grade tracing (trace/span/generation) | ❌ not started | Engine |
| Session grouping | ❌ not started | Engine |
| Score attachment | ❌ not started | Engine |
| SDK integration (decorator/wrapper) | ❌ not started | Engine |
| Dataset freeze-slice | ✅ done | Engine |
| Replay + compare | ✅ done | Engine |
| Promotion primitive | ✅ done | Engine |
| Audit log | ✅ done | Engine |
| Anomaly detection | ❌ not started | Blue team |
| Backtest orchestration | ✅ done (as mode-backtest) | Blue team |
| Promotion gate | ✅ done | Blue team |
| Scoring metrics (correctness, faithfulness, etc.) | ❌ not started | Eval |
| Multi-turn scenario testing (full agent behavior) | ❌ not started | Eval |
| Golden answer comparison | ❌ not started | Eval |
| Pairwise comparison | ❌ not started | Eval |
| Edge case testing | ❌ not started | Eval |
| Assertion-based testing | ❌ not started | Eval |
| CI/CD integration | ❌ not started | Eval |
| Production → test case generation | ❌ not started | Eval |
| Feature-completion trigger | ❌ not started | Eval |
| Dashboard (basic 6 pages) | ✅ done | Apps |
| Dashboard (trace viewer) | ❌ not started | Apps |
| Naming: Mode A/B → Red/Blue/Eval | ❌ not started | All |
| Package rename: mode-backtest → mode-blue-team | ❌ not started | Blue team |
| Package scaffold: mode-eval | ❌ not started | Eval |

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

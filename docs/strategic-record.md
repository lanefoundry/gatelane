# Strategic record (2026-08-30)

> v1.0 (2026-08-30)
> This document records the strategic decision chain that led to gatelane. For positioning and roadmap, see `positioning.md` and `roadmap.md`.

## 1. Starting point: Agent Platform as Workflow Control Plane

`agent-platform` (originally named `agent-gateway`, then `Agent Platform`) was an open-source Cloudflare-deployable AI workflow control plane. Its 7 OpenSpec capabilities spanned:

- `flow-runtime` — versioned flows, step DAG, checkpoint, resume, retry
- `skill-packages` — versioned skills with explicit flow-step bindings
- `policy-runtime-controls` — budget / allow-deny / approval gates / loop protection
- `observability-evidence-artifacts` — trace + evidence + artifact versioning
- `evaluation-learning-loop` — eval suites, quality gates, learning signals
- `context-memory-management` — typed context blocks, scoped memory
- `provider-tool-routing` — provider readiness, health-aware routing, proxy model mapping

The product positioning was "auditable AI agent workflow control plane with 8 commands: Define, Configure, Run, Observe, Control, Verify, Produce, Improve."

## 2. First hit: workflow production runtime is empty

The `WorkflowAudit` (21 min, 2026-08-30) revealed two divergent runtime paths:

- `InMemoryFlowRuntime` (local dev only) — implements the full spec (createRun, completeStep, failStep, cancelRun, retryStep, resumeLatestCheckpoint, saveCheckpoint).
- `DeepResearchWorkflow` (production) — only 4 hardcoded `step.do()` calls, no DAG walking, no edge condition evaluation, no checkpoint, no resume, no approval gate, no eval gate.

The D1 schema defined 30+ tables (checkpoints, evidence_items, claims, citations, artifacts, artifact_versions, trace_spans, eval_*, learning_signals, skill_proposals, approval_requests, escalation_records, context_snapshots), but `D1AgentRepository` never wrote to them. The `deleteRun` method, however, did delete them.

README and `agent-gateway-plan.md` promised `POST /api/runs/:runId/resume`. Neither `apps/worker/src/index.ts` nor `scripts/local-dev-server.ts` exposed it.

The 10-step Deep Research DAG with conditional edges (`coverage_insufficient`, `passed`) in `packages/core/src/deep-research-flow.ts` was **not executed in production**. The `DeepResearchWorkflow` collapsed it into 4 sequential labels.

**Conclusion**: spec was comprehensive; production runtime was a thin façade. The "Workflow Control Plane" positioning was not backed by shipping software.

## 3. Second hit: AI gateway market is commoditized

`.research/2026-08-30-ai-gateway-landscape.md` (39 KB) cataloged 9 commercial + 13 OSS AI gateway projects:

- **Aggregators** (managed): OpenRouter ($1.3B post-money, $160M ARR, 100T tokens/mo, 8M users), Unify, Martian.
- **Production gateways** (managed): Portkey (acq by PANW), Helicone (acq by Mintlify, maintenance), Cloudflare AI Gateway, Vercel AI Gateway.
- **Self-hostable infra**: LiteLLM (28.4K★), Bifrost (4.3K★, Go, 11µs at 5K RPS), Helicone (6.1K★, OSS), agentgateway (1.9K★, LF), Envoy AI Gateway (2.0K★, CNCF), Kong AI Gateway (parent 41.4K★), OneAPI (21.7K★), NewAPI (16.5K★).

Three unicorn-funded, two already acquired. Routing / caching / pricing-database / key-management is commoditized.

**Conclusion**: building a custom AI gateway would be 6-8 weeks of duplicative work for marginal differentiation. The OpenAI-compatible proxy layer in `agent-platform` was marked `experimental / not for production`.

## 4. Third hit: the real whitespace

`.research/2026-08-30-ai-response-observability-market.md` (47 KB) showed that despite 4 acquisitions in 2025-2026 (WhyLabs→Apple, Helicone→Mintlify, Portkey→PANW, Langfuse→ClickHouse), the **promotion-on-backtest-delta primitive** has no incumbent.

Every product has dataset + replay + compare. None of them connect compare to deployment decisions.

`.research/2026-08-30-ai-agent-security-market.md` (46 KB) showed that the AI agent security market (Lakera→Check Point, Protect AI→PANW, CalypsoAI→F5, Prompt→SentinelOne, Aim→Cato, Apex→Tenable, SPLX→Zscaler) is also consolidating, with **coding-agent protection and MCP/non-human-identity governance** as the 2026-2027 wedge.

**Conclusion**: combine red team mode (attack probes) + backtest mode (model upgrade probes) on a **shared engine**, with the **promotion gate** as the spine. This is gatelane.

## 5. Brand pivot: from Agent Platform to *-lane family

The Agent Platform name was too coupled to the failed workflow positioning. We chose a new naming pattern: `*-lane` family under `lanefoundry` (a single GitHub org).

| Product | Lane | Role |
|---|---|---|
| `groundlane` | trusted content access lane | AI-agent-facing content access with full provenance |
| `looplane` | iteration loop lane | coding agent run-time (renamed from `rivumi`) |
| `gatelane` | promotion gate lane | red team + backtest + promotion gate |

`lanefoundry` chosen over `lanehq` (pronunciation), `forgelane` (collision risk), `lane-systems` (too generic).

Each product:
- Has its own repo, docs, release cadence
- Connects via SDK / contract only — no shared code
- Independent of the others' fate

## 6. From 4-product vision to 1-product focus

The original 4-product vision:
1. `groundlane` (existed)
2. `rivumi` / `looplane` (existed, renamed)
3. `gatelane` (new)
4. ~~`agent-platform` workflow~~ (parked, repo transferred / archived)

The 4-product vision is not abandoned — `groundlane`, `looplane`, `gatelane` are three of the four. The fourth (workflow control plane) is parked, and the three active products share the **promotion-on-backtest-delta primitive** as their unifying concept where relevant.

## 7. The pivot, condensed

```text
agent-platform (Workflow Control Plane, 7 specs, 8 commands)
  → audit: production runtime is empty
    → pivot 1: "ship the workflow runtime"
      → estimated 3-6 months of work, uncertain
        → pivot 2: "ship a stable AI gateway first"
          → market research: 22+ options, commoditized
            → pivot 3: "AI response observability + backtest"
              → real whitespace: promotion-on-backtest-delta
                → pivot 4: "AI agent security 紅藍隊"
                  → combine: red team + backtest on shared engine
                    → pivot 5: rename to *-lane family
                      → land: gatelane (this repo)
```

## 8. What's preserved from agent-platform

- **`evaluation-learning-loop` spec** → gatelane Mode B (backtest) draws on the conceptual structure
- **`policy-runtime-controls` spec** → gatelane's patch advisor draws on the input/tool/output/budget guard structure
- **`provider-tool-routing` spec** → future v0.2 MCP/non-human-identity governance
- **`observability-evidence-artifacts` spec** → gatelane's audit log architecture
- **D1 schema patterns** → gatelane's capture/dataset/replay/promotion tables follow the same pattern
- **7 OpenSpec specs** → preserved in `agent-platform` repo as reference; not directly imported

## 9. References

- `.research/2026-08-30-agent-workflow-market.md` (51 KB) — agent workflow market
- `.research/2026-08-30-ai-gateway-landscape.md` (39 KB) — AI gateway market
- `.research/2026-08-30-ai-response-observability-market.md` (47 KB) — backtest whitespace
- `.research/2026-08-30-ai-agent-security-market.md` (46 KB) — agent security market (incl. Taiwan)
- `docs/product/positioning/workflow-market-landscape.md` — spec vs 主流系統對照
- `docs/product/brand/brand-architecture.md` — *-lane family brand spec
- `docs/product/brand/naming-decisions.md` — naming decisions
- `agent-gateway-plan.md` — original Workflow Control Plane plan
- `history://WorkflowAudit` — workflow runtime audit transcript
- `openspec/specs/` — seven preserved specs

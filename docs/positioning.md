# gatelane positioning

> v0.1 (2026-08-30)
> For internal lanefoundry team alignment. Not a marketing doc.
## The wedge

**The promotion-on-backtest-delta primitive.** The AI-era gate that closes the loop from "new model version" to "should I ship it."

## What is a "promotion gate"?
**The promotion-on-backtest-delta primitive.** The AI-era gate that closes the loop from "new model version" to "should I ship it."
**The promotion-on-backtest-delta primitive.**

## What is a "promotion gate"?

A term borrowed from release engineering. In CI/CD, "promote" means moving a build from one stage to the next:

```text
dev → staging → canary → production
       ↑        ↑         ↑
       promote  promote    promote
```

A "promotion gate" is the **check that must pass before a version is allowed to advance to the next stage**. Traditional gates include "unit tests pass," "code review approved," "no high-severity security scan findings."

In the AI agent era, the "version" being promoted is no longer just code — it can be a new model (GPT-5 → GPT-5.1), a new prompt (system message updated), a new agent routing configuration, or a new tool schema. Each of these needs its own gate.

The AI-era promotion gate adds a new dimension: **the new version must perform at least as well as the current version on a frozen slice of production traffic, AND must not regress on known attack payloads**. This is the primitive that no existing product ships end-to-end.

**The promotion-on-backtest-delta primitive.**

The 2025-2026 AI agent observability / eval market is consolidated:

| Product | Owner | State |
|---|---|---|
| Langfuse | **ClickHouse** (acq Jan 2026) | OSS continues, dev direction unclear |
| Helicone | **Mintlify** (acq Mar 2026) | Maintenance mode |
| Portkey | **Palo Alto Networks** (closed May 2026) | Inside Prisma AIRS |
| Braintrust | Independent | $80M Series B at $800M post (Feb 2026) |
| Arize AI | Independent | $70M Series C (Feb 2025) |
| LangSmith | LangChain | Bundled with LangGraph |
| Datadog LLM | Datadog | APM extension |
| Langfuse OSS | — | 33.9k stars |
| MLflow | Databricks / LF | 27.7k stars |
| Promptfoo | OpenAI (acq'd) | 24.7k stars, MIT, used by OpenAI/Anthropic |

What **every product documents** as "backtest" but **none of them turn into a promotion primitive**:

- **LangSmith**: "Backtesting evaluates new application versions against historical production data" — tutorial-grade, but no auto-promote.
- **Langfuse**: April 2026 experiments rebuild supports running on "sliced production trace windows" — but no signed promotion report.
- **Datadog**: Playground "replay trace with alt prompt/provider" — single-trace primitive, not dataset-level.
- **Braintrust**: "Pull low-score traces into datasets" + Loop agent — but Loop iterates prompts, doesn't gate traffic.
- **Vellum**: "back-testing is possible if you capture production inputs/outputs" — passing mention in a blog post.

**No product ships a CI/CD-native `if new-model beats baseline on frozen production slice by Δ ≥ X, route 100% of traffic; else auto-rollback` primitive.** That is the wedge.

## Why the AI agent security angle complements, not competes

The AI agent security market is also active in 2025-2026 (see `docs/strategic-record.md` §7), but most players (Lakera, Mindgard, Noma, TrojAI, Pillar, Straiker, CyCraft) compete on **attack surface coverage** — how many attacks you can throw, how many frameworks you map to.

gatelane's red team mode is **deliberately smaller** than these players' attack libraries. We're not trying to be the broadest red team. We're trying to be the **one tool that runs both red team and backtest from the same engine**, with **promotion gate as the spine**.

The differentiator is not "we have more attack vectors" — it's "we close the loop":

```text
attack payload → vulnerability found → patch → backtest on frozen prod slice → regression check → auto-canary
```

Most security players stop at "vulnerability found." Most observability players stop at "regression check." gatelane closes both.

## Why we don't build a general LLM gateway

| Category | Players | Verdict |
|---|---|---|
| Aggregator | OpenRouter ($1.3B), Unify, Martian | Don't compete — money + scale |
| Self-host infra | LiteLLM (28.4k★), Bifrost (4.3k★), Helicone (6.1k★, maintenance) | Don't compete — commoditized |
| Hyperscaler | Bedrock / Vertex / Foundry | Don't compete — only inside their cloud |
| Production gateway | Portkey (PANW), Cloudflare AI GW, Vercel AI GW | Don't compete — adjacent, not core |

The 22+ credible AI gateway options already cover the routing / caching / pricing-database / key-management layer. Building our own would be 6-8 weeks of duplicative work for marginal differentiation. **We will plug into these, not replace them.** gatelane's capture SDK reads whatever the agent called; the model provider is an attribute, not a product decision.

## Threat model scope (v1)

| Source | v1 scope |
|---|---|
| OWASP Top 10 for Agentic Applications (ASI01–ASI10) | Full coverage |
| MITRE ATLAS (v5.4.0) | Tactic-level coverage, key techniques |
| OWASP LLM Top 10 (2026) | Full coverage |
| NIST AI 600-1 | Coverage of 12 risk categories |
| **Taiwan AI Basic Act (2025/12/23)** | **v2 scope** — compliance mode after v1 ships |

## Who buys

| Buyer | What they need | What gatelane gives them |
|---|---|---|
| **Security team at a company shipping agents** | "Are we exposed to known attack vectors? How do we know the patch worked?" | Red team: attack report. Blue team: regression check. |
| **ML / platform team at a company shipping LLM features** | "Can we ship a new model version without watching the comparison view all day?" | Blue team: promotion gate. |
| **Coding agent team** | "What if my coding agent is hijacked via prompt injection? How do I know when I've fixed it?" | Red team on coding-agent-specific attacks. Blue team to validate the fix. |
| **CISO / compliance officer at a regulated company** | "Are we compliant with AI Basic Act / NIST AI 600-1?" | v2 scope — compliance mode built on the same engine. |

## What this is NOT

- **Not a general LLM gateway.** Use OpenRouter / LiteLLM / Bifrost for routing.
- **Not a pure APM.** Use Datadog / New Relic / Honeycomb for trace analytics.
- **Not a workflow control plane.** The Agent Platform pivot is parked (see `docs/strategic-record.md`).
- **Not a hosted service.** Self-host on your Cloudflare account.
- **Not a research project.** The 5-6 week demo is meant to ship, not to publish papers.

## Open questions

- Do we open-source from day 1, or wait until v0.1 demo ships? (lean: open-source from day 1 — the threat model is public knowledge anyway)
- Do we charge for hosted mode, or only support self-host? (lean: only self-host in v0.1; revisit at v1.0)
- What's the relationship with `groundlane` provenance? Could `gatelane` use `groundlane` provenance as one risk input? (likely yes for v0.2)

## References

- `docs/strategic-record.md` — full strategic context (2026-08-30 decision chain)
- `.research/2026-08-30-ai-agent-security-market.md` — agent security market (incl. Taiwan)
- `.research/2026-08-30-ai-response-observability-market.md` — backtest market whitespace
- `.research/2026-08-30-ai-gateway-landscape.md` — why we don't build a gateway
- `docs/roadmap.md` — 5-6 week demo plan

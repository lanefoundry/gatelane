# gatelane positioning

> v0.2 (2026-08-30)
> For internal lanefoundry team alignment. Not a marketing doc.

## The wedge

**The promotion-on-backtest-delta primitive.** The AI-era gate that closes the loop from "new model version" to "should I ship it."

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

## Why the wedge exists

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

## One product, three dataset sources

gatelane is one product. The verb is `promote(candidate, dataset, policy) → signed decision`. The dataset is pluggable — three source variants feed the same gate:

- **Red-team dataset** — curated attacks mapped to OWASP Agentic Top 10 + MITRE ATLAS. Used to find vulnerabilities in a new agent and to verify a patch holds.
- **Production slice** — frozen production traces captured by the agent's normal calls. Used to gate routine model / prompt upgrades.
- **Compliance dataset** — curated cases mapped to NIST AI 600-1 + Taiwan AI Basic Act + EU AI Act + sectoral overlays. Used for CISO / regulator sign-off. (v2 scope.)

The engine, capture SDK, audit log, and promotion primitive are shared infrastructure reused across all three sources. The source adapters are thin and pluggable. Switching dataset source is configuration, not an engine change.

## Why the AI agent security angle complements, not competes

The AI agent security market is also active in 2025-2026 (see `docs/strategic-record.md` §7), but most players (Lakera, Mindgard, Noma, TrojAI, Pillar, Straiker, CyCraft) compete on **attack surface coverage** — how many attacks you can throw, how many frameworks you map to.

```text
attack payload → vulnerability found → patch
                                       ↓
                  same gate on same red-team dataset → verify patch holds
                                                       ↓
                                       gate on production slice → auto-canary
```

Most security players stop at "vulnerability found." Most observability players stop at "regression check." gatelane closes both — under one promotion primitive.

The engine, capture SDK, audit log, and promotion primitive are shared infrastructure reused across all three sources. The source adapters are thin and pluggable. Switching dataset source is configuration, not an engine change.

## What the gate accepts as a candidate

| Candidate type | Example ref | SHA captured in PromotionReport | Real-world attack it closes the gap for |
|---|---|---|---|
| Model | `model:gpt-5` | model registry SHA | (eval regressions, prompt injection in the model itself) |
| Prompt template | `prompt:system-v2` | template content hash | (ASI01 direct injection bypasses) |
| Skill version | `skill:citation-extractor@1.3.0` | skill package SHA | **ASI04** supply chain — version downgrade, prompt-template injection via skill registry |
| Agent routing config | `config:agent-routing-experimental` | config file SHA | **ASI08** dispatcher bypass — corebreak, Flowise custom MCP command injection |
| Tool / MCP server schema | `tool:mcp-server-foo@1.2.0` | tool schema hash | **ASI02** tool abuse — deadbugz MCP supply chain, Splunk MCP server toolkit RCE |
| Eval dataset / scoring rubric | `eval:xinference-suite-v3` | eval suite SHA | Xinference eval-injection RCE — agent trusts eval output as instruction |
| KB / RAG corpus | `kb:groundlane-corpus-q3` | corpus snapshot SHA | **LLM08** vector & embedding poisoning, llms.txt supply chain |
| Memory backend | `memory:persistence-backend` | backend config + storage schema SHA | AI "mind virus" persistent memory propagation (2026-08-19) |
| Dispatcher / orchestration rules | `dispatcher:corebreak-rules` | dispatcher rules SHA | Dispatch-layer bypass (corebreak 2026-08-17) |
| Guardrail / input filter | `guardrail:input-filter-v2` | filter rules SHA | Claude Code Auto Mode module shadowing — guardrail allowed malicious action but blocked cleanup |

Multiple candidates of different types can run in a single gate run. The PromotionReport carries the SHA of every candidate + judge, the dataset version, the policy, and the approver — so 6 months later the auditor can re-derive which versions of every component were promoted, against which dataset, judged by which models, and signed off by whom.

## Compare-view vs promotion gate

The gap between "every product has dataset + replay + compare" and "promotion gate" is exactly the gap between a **read** and a **write**. Existing products expose a comparison view (read). gatelane exposes a decision (write): `promote | rollback | hold_for_review`, signed, audit-logged, CI/CD-consumable.

| Capability | Comparison view (existing products) | Promotion gate (gatelane) |
|---|---|---|
| Dataset | Yes | Yes |
| Replay | Yes | Yes |
| Compare | Yes | Yes |
| Signed promotion report | No | Yes |
| Auto-route / auto-rollback | No | Yes |
| Audit-logged approver | No | Yes |
| Reproducible 6 months later | Varies | Yes (full provenance) |

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
| **Taiwan AI Basic Act (2025/12/23)** | **v2 scope** — compliance dataset source after v1 ships |

## Who buys

| Buyer | What they need | Dataset sources they reach for |
|---|---|---|
| **Security team at a company shipping agents** | "Are we exposed to known attack vectors? How do we know the patch worked?" | Red-team dataset (find holes) → same gate (verify patch) |
| **ML / platform team at a company shipping LLM features** | "Can we ship a new model version without watching the comparison view all day?" | Production slice |
| **Coding agent team** | "What if my coding agent is hijacked via prompt injection? How do I know when I've fixed it?" | Red-team dataset (find) → same gate on same dataset (verify) |
| **CISO / compliance officer at a regulated company** | "Are we compliant with AI Basic Act / NIST AI 600-1?" | Compliance dataset (v2) |

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
- Does the compliance dataset source become its own SKU, or stay as a v2 toggle on the same gate? (current lean: v2 toggle — same product, configured regime.)

## References

- `docs/strategic-record.md` — full strategic context (2026-08-30 decision chain)
- `.research/2026-08-30-ai-agent-security-market.md` — agent security market (incl. Taiwan)
- `.research/2026-08-30-ai-response-observability-market.md` — backtest market whitespace
- `.research/2026-08-30-ai-gateway-landscape.md` — why we don't build a gateway
- `docs/roadmap.md` — 5-6 week demo plan
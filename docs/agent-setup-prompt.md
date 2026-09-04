# Agent Setup Prompt

> Copy-paste this prompt to your AI coding assistant (Claude Code, Cursor, Copilot, etc.)
> to quickly integrate gatelane into your project.

---

## Prompt

```
I want to integrate gatelane — a pre-production safety and eval gate for AI agents.
gatelane has three modes: Red Team (attack probing), Blue Team (backtest upgrades),
and Eval (automated LLM output evaluation). It runs on Cloudflare Workers (D1 + R2 + KV).

Here's what I need you to do:

### 1. Install

Add gatelane as a dependency. The packages are:
- @gatelane/engine — capture SDK, dataset, replay, compare, tracing, promotion
- @gatelane/mode-red-team — 50+ attack vectors, runner, report generator
- @gatelane/mode-blue-team — backtest flow (freeze → replay → compare → promote/rollback)
- @gatelane/mode-eval — automated LLM output evaluation with judge prompts
- @gatelane/shared — shared types and D1 schema

### 2. Capture LLM calls

Wrap every LLM call with gatelane's capture SDK. Two options:

**Option A: SDK (same Worker / same process)**
```ts
import { capture } from "@gatelane/engine";

const { response, record } = await capture(env, {
  prompt: [{ role: "user", content: userInput }],
  model: "gpt-4o",
  metadata: { agentVersion: "1.0.0" },
}, async () => {
  return await myLlmCall(userInput);
});
```

**Option B: HTTP API (any runtime)**
```ts
await fetch("https://your-gatelane.workers.dev/v1/capture", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_CAPTURE_TOKEN",
  },
  body: JSON.stringify({
    prompt: [{ role: "user", content: userInput }],
    model: "gpt-4o",
    response: llmResponse,
    metadata: { agentVersion: "1.0.0" },
  }),
});
```

### 3. Add tracing (optional but recommended)

Use the tracing SDK to instrument your agent pipeline:
```ts
import { traced, withGeneration } from "@gatelane/engine";

const { trace, results } = await traced(env, "my-pipeline")
  .span("step-1", async () => { /* ... */ })
  .span("step-2", async (ctx) => {
    const gen = withGeneration(env, {
      traceId: ctx.traceId,
      name: "llm-call",
      model: "gpt-4o",
      parentSpanId: ctx.spanId,
    }, async (messages) => myLlmCall(messages));
    return (await gen(messages)).completion;
  })
  .run(input);
```

### 4. Run red team scan

```ts
import { allVectors, runAttack, generateReport } from "@gatelane/mode-red-team";

const results = await Promise.all(
  allVectors.map((v) => runAttack(v, {
    url: "http://localhost:3000/api/chat",
    name: "my-agent",
  })),
);
const report = generateReport(results, ["my-agent"]);
```

### 5. Set up backtest upgrade gate

```ts
import { backtest } from "@gatelane/mode-blue-team";

const report = await backtest(env, {
  window: "7d",
  candidateModel: "gpt-4.1",
  baselineModel: "gpt-4o",
  threshold: 0.02,
  judge: async (prompt, response) => { /* return 0-1 score */ },
  execute: async (prompt, model) => { /* call LLM */ },
});
// report.decision === "promote" | "rollback"
```

### 6. Environment variables needed

```
GATELANE_JUDGE_PROVIDER=openai    # or anthropic, google
GATELANE_JUDGE_API_KEY=sk-...
GATELANE_JUDGE_MODEL=gpt-4o
GATELANE_CAPTURE_TOKEN=<random 64-char hex>
```

### 7. Cloudflare bindings (wrangler.toml)

```toml
[[d1_databases]]
binding = "DB"
database_name = "gatelane"
database_id = "your-db-id"

[[r2_buckets]]
binding = "CAPTURES"
bucket_name = "gatelane-captures"

[[kv_namespaces]]
binding = "GATELANE_KV"
id = "your-kv-id"
```

### Key constraints
- Captures are stored in D1 (metadata) + R2 (raw JSON)
- The capture token must be >= 32 characters
- Red team's runAttack sends POST to target URL with { messages: [...] } body
- Backtest judge function must return a number between 0 and 1
- All types are in @gatelane/shared (CaptureRecord, Dataset, ReplayRun, PromotionReport, etc.)

### Reference
- Repo: https://github.com/lanefoundry/gatelane
- Examples: see examples/ directory in the repo
- Dashboard: TanStack Start SSR app served from apps/web/ on the same Worker
```

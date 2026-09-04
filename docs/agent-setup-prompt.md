# Agent Setup Prompt

> Copy-paste the prompt below to your AI coding assistant (Claude Code, Cursor, Copilot, etc.)
> to quickly integrate gatelane into your project.
>
> Three paths depending on what you need:
> - **Red team only** — no deployment needed, just `pnpm install` and scan your agent
> - **Integrator** — your team already deployed gatelane, just call the HTTP API
> - **Operator** — deploy the full platform (Cloudflare Worker)

---

## Red team only — no deployment needed

> Just want to scan your agent for vulnerabilities? No Cloudflare, no deployment, no account needed.

````
I want to run gatelane's red team scan against my agent to find vulnerabilities.
No deployment needed — it just sends attack payloads via HTTP.

### 1. Install

```bash
git clone https://github.com/lanefoundry/gatelane.git
cd gatelane && pnpm install
```

### 2. Scan my agent

```ts
import { allVectors, runAttack, generateReport } from "@gatelane/mode-red-team";

const results = await Promise.all(
  allVectors.map((v) => runAttack(v, {
    url: "http://localhost:3000/api/chat",  // my agent endpoint
    name: "my-agent",
  })),
);
const report = generateReport(results, ["my-agent"]);
// report contains: successful attacks, payloads, evidence, patch recommendations
```

### Key constraints
- runAttack sends POST { messages: [{role: "user", content: payload}] } to the target URL
- Target must accept POST with JSON body and return text
- 50+ vectors across 6 categories: direct prompt injection, indirect via tool,
  chain attack, context window flood, memory poisoning, tool abuse
- Also supports multi-turn attack scenarios via runMultiTurn()
````

---

## For Integrators — add gatelane to your existing agent

> This is the common case. Your team already deployed a gatelane Worker.
> You just need to send LLM calls to it.

````
I want to integrate with gatelane — a pre-production safety and eval gate for AI agents.
A gatelane Worker is already deployed. I need to instrument my agent to send data to it.

### 1. Capture every LLM call (HTTP — works from any runtime)

After each LLM call, POST the prompt + response to gatelane:

```ts
const GATELANE_URL = "https://gatelane.your-team.workers.dev"; // your deployed URL
const GATELANE_TOKEN = process.env.GATELANE_CAPTURE_TOKEN;

async function captureToGatelane(
  prompt: Array<{ role: string; content: string }>,
  model: string,
  response: unknown,
  metadata?: Record<string, unknown>,
) {
  await fetch(`${GATELANE_URL}/v1/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GATELANE_TOKEN}`,
    },
    body: JSON.stringify({ prompt, model, response, metadata }),
  });
}
```

Call this after every LLM call in my agent:

```ts
const llmResponse = await callMyLLM(messages, "gpt-4o");
await captureToGatelane(messages, "gpt-4o", llmResponse, {
  agentVersion: "1.0.0",
  feature: "chat",
  userId: currentUser.id,
});
```

### 2. View results

Open the gatelane dashboard (same URL as the API) in a browser to see:
- Captured LLM calls
- Datasets (frozen production slices)
- Replay runs and promotion reports
- Red team vulnerability reports
- Audit log
- Traces with timeline view

### 3. Query the API

```
GET /v1/datasets          — list frozen datasets
GET /v1/replay-runs       — list backtest runs
GET /v1/promotions        — list promotion reports (promote/rollback decisions)
GET /v1/audit-log         — list audit events
GET /v1/traces            — list traces
GET /v1/traces/:id        — get trace detail (spans, generations, scores)
```

### Key constraints
- The capture token must be >= 32 characters
- POST body: { prompt: [{role, content}], model: string, response: any, metadata?: {} }
- Response: { id: string, traceId: string }
- All endpoints return JSON

### Environment variable needed in my project
```
GATELANE_CAPTURE_TOKEN=<the token from the gatelane operator>
```
````

---

## For Operators — deploy gatelane

> Do this once per team. Everyone else uses the HTTP API above.

````
I want to deploy gatelane — a pre-production safety and eval gate for AI agents.
It runs as a Cloudflare Worker with D1 + R2 + KV storage.

### 1. Clone and install

```bash
git clone https://github.com/lanefoundry/gatelane.git
cd gatelane
pnpm install
cp .env.example .env
```

### 2. Configure .env

```bash
GATELANE_JUDGE_PROVIDER=openai    # or anthropic, google
GATELANE_JUDGE_API_KEY=sk-...
GATELANE_JUDGE_MODEL=gpt-4o
GATELANE_CAPTURE_TOKEN=$(openssl rand -hex 32)
```

### 3. Create Cloudflare resources

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create gatelane
pnpm exec wrangler r2 bucket create gatelane-captures
pnpm exec wrangler kv namespace create GATELANE_KV
# Paste the returned IDs into wrangler.toml
```

### 4. Deploy

```bash
pnpm secrets:setup
pnpm run deploy
```

### 5. Local development

```bash
pnpm dev    # starts unified Worker at localhost:8787 (API + dashboard)
```

### 6. Run red team scan against an agent

```ts
import { allVectors, runAttack, generateReport } from "@gatelane/mode-red-team";

const results = await Promise.all(
  allVectors.map((v) => runAttack(v, {
    url: "http://localhost:3000/api/chat",
    name: "my-agent",
  })),
);
const report = generateReport(results, ["my-agent"]);
// report contains: successful attacks, payloads, evidence, patch recommendations
```

### 7. Run backtest upgrade gate

```ts
import { backtest } from "@gatelane/mode-blue-team";

const report = await backtest(env, {
  window: "7d",
  candidateModel: "gpt-4.1",
  baselineModel: "gpt-4o",
  threshold: 0.02,
  judge: async (prompt, response) => { /* return 0-1 score */ },
  execute: async (prompt, model) => { /* call LLM, return response */ },
});
// report.decision === "promote" → route to new model
// report.decision === "rollback" → keep baseline
```

### Architecture
- apps/web/ — unified Cloudflare Worker (TanStack Start SSR dashboard + Hono API)
- packages/engine/ — capture SDK, dataset, replay, compare, tracing, promotion
- packages/mode-red-team/ — 50+ attack vectors, runner, report generator
- packages/mode-blue-team/ — backtest flow (freeze → replay → compare → promote/rollback)
- packages/mode-eval/ — automated LLM output evaluation
- packages/shared/ — TypeScript types and D1 schema

### Cloudflare bindings (wrangler.toml)

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
````

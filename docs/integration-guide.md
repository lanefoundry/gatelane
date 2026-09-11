# Integration Guide

How to add gatelane's capture, eval, red team, and promotion gate to an existing AI application.

## Prerequisites

- Your app makes LLM calls (any provider)
- Node.js 22+ or Python 3.10+
- gatelane repo cloned (not yet published to npm/PyPI)

## Level 1: Capture — observe every LLM call

### Install the SDK

```bash
# TypeScript (file reference until published)
pnpm add @lanefoundry/gatelane-sdk@file:../gatelane/packages/gatelane-sdk

# Python
pip install -e ../gatelane/packages/gatelane-sdk-py
```

> **Cloudflare Workers note:** The barrel import (`@lanefoundry/gatelane-sdk`)
> re-exports `storage-fs.ts` which uses `node:fs`. If your app runs on Workers
> or any edge runtime without Node.js built-ins, import selectively:
>
> ```ts
> import { capture } from '@lanefoundry/gatelane-sdk/capture'
> import { setStorage } from '@lanefoundry/gatelane-sdk/storage'
> import { HttpStorage } from '@lanefoundry/gatelane-sdk/storage-http'
> ```

### Choose a storage adapter

| Adapter | When to use | Setup |
|---|---|---|
| `InMemoryStorage` | Tests, development without persistence | Default — no setup needed |
| `FilesystemStorage` | Local dev with persistence | `setStorage(new FilesystemStorage('./captures'))` |
| `HttpStorage` | Production — sends captures to gatelane Worker | `setStorage(new HttpStorage({ endpoint, token }))` |

Initialize once at app startup:

```ts
import { setStorage, HttpStorage } from '@lanefoundry/gatelane-sdk'

setStorage(new HttpStorage({
  endpoint: process.env.GATELANE_ENDPOINT!,
  token: process.env.GATELANE_CAPTURE_TOKEN!,
}))
```

### Wrap your LLM calls

Find the choke point — the function all LLM calls flow through. Wrap it with `capture()`:

```ts
import { capture } from '@lanefoundry/gatelane-sdk'

// Before
const response = await llm.invoke(messages)

// After
const response = await capture({
  prompt: messages.map(m => ({ role: m.role, content: m.content })),
  model: 'claude-sonnet-4',
  metadata: { endpoint: '/api/chat', traceId },
}, () => llm.invoke(messages))
```

`capture()` is fire-and-await: a storage write failure logs to stderr but never throws, so your app is unaffected.

**Python:**

```python
from gatelane_sdk import capture

async with capture(prompt=messages, model="claude-sonnet-4") as cap:
    response = await llm.invoke(messages)
    cap.set_output(response)
```

### Best practice: find your choke point

Most apps have a single function all LLM calls pass through. Wrap that one function instead of every endpoint:

| Pattern | Choke point |
|---|---|
| LangChain / LangGraph | The `model.invoke()` or `ChatModel` call |
| Direct SDK (OpenAI/Anthropic) | Your wrapper function that sets defaults |
| Multi-provider router | The router's dispatch function |
| Hono / Express middleware | A middleware that wraps `next()` |

One function wrapped = full coverage.

If an endpoint calls LLMs directly (bypassing the choke point), wrap that call site separately.


## Level 2: Eval — test your agent before and after changes

Once you have captures (Level 1) or can write a query list manually, use the CLI:

### Bootstrap an eval config

```bash
# From a query list
npx gatelane init \
  --url http://localhost:8787/api/chat \
  --queries queries.txt \
  --response-path answer

# This creates gatelane.yaml with test, red team, and blue team sections
```

### Run eval

```bash
npx gatelane eval --tag before-change
# ... make your changes ...
npx gatelane eval --tag after-change
npx gatelane compare --baseline before-change --candidate after-change
```

Exit code 0 = no regressions. Use this in CI:

```yaml
# .github/workflows/eval.yml
- name: Eval gate
  run: |
    npx gatelane eval --tag ${{ github.sha }}
    npx gatelane compare --baseline main --candidate ${{ github.sha }}
```


## Level 3: Red team — scan for injection vulnerabilities

Point `gatelane attack` at any endpoint that accepts user input:

```bash
npx gatelane attack https://your-app.com/api/chat \
  --request-template '{"message": "{{payload}}"}' \
  --header "Authorization: Bearer $TOKEN" \
  --report attack-report.json
```

The built-in attack library covers 50+ vectors across 6 categories:
- Direct prompt injection
- Indirect injection via tools
- Chain attacks (multi-step)
- Context window flood
- Memory poisoning
- Tool abuse

Each payload maps to OWASP Agentic Top 10 (ASI01–ASI10).


## Level 4: Promotion gate — automate model upgrade decisions

After running Level 1 in production for a few days:

```bash
npx gatelane gate \
  --candidate model:claude-opus-4 \
  --baseline model:claude-sonnet-4 \
  --dataset-source prod-slice \
  --judges claude-sonnet-4,gpt-4o
```

This:
1. Freezes a slice of production captures into an immutable dataset
2. Replays the dataset against both models
3. Computes quality Δ, cost Δ, latency Δ
4. Builds a judge stability matrix (do judges agree?)
5. Outputs a signed `PromotionReport` with decision: `promote | rollback | hold_for_review`


## Framework recipes

### Cloudflare Workers (Hono)

```ts
// src/middleware/gatelane.ts
import { capture } from '@lanefoundry/gatelane-sdk/capture'
import { setStorage } from '@lanefoundry/gatelane-sdk/storage'
import { HttpStorage } from '@lanefoundry/gatelane-sdk/storage-http'
import type { MiddlewareHandler } from 'hono'

let initialized = false
export const gatelaneMiddleware: MiddlewareHandler = async (c, next) => {
  if (!initialized) {
    const endpoint = c.env.GATELANE_ENDPOINT
    const token = c.env.GATELANE_CAPTURE_TOKEN
    if (endpoint && token) {
      setStorage(new HttpStorage({ endpoint, token }))
    }
    initialized = true
  }
  await next()
}
```

Use selective imports to avoid `node:fs` in the bundle.

### Next.js API Routes

```ts
// lib/gatelane.ts
import { setStorage, HttpStorage } from '@lanefoundry/gatelane-sdk'

if (process.env.GATELANE_ENDPOINT) {
  setStorage(new HttpStorage({
    endpoint: process.env.GATELANE_ENDPOINT,
    token: process.env.GATELANE_CAPTURE_TOKEN!,
  }))
}
```

```ts
// app/api/chat/route.ts
import '@/lib/gatelane'  // side-effect init
import { capture } from '@lanefoundry/gatelane-sdk'

export async function POST(req: Request) {
  const { message } = await req.json()
  const answer = await capture(
    { prompt: [{ role: 'user', content: message }], model: 'gpt-4o' },
    () => llm.chat(message),
  )
  return Response.json({ answer })
}
```

### Django + DRF

```python
# settings.py
from gatelane_sdk import configure
configure(endpoint=os.environ["GATELANE_ENDPOINT"], token=os.environ["GATELANE_CAPTURE_TOKEN"])
```

```python
# views.py
from gatelane_sdk import capture

class ChatView(APIView):
    async def post(self, request):
        async with capture(prompt=request.data["messages"], model="gpt-4o") as cap:
            response = await llm.invoke(request.data["messages"])
            cap.set_output(response)
        return Response({"answer": response})
```

### LangChain / LangGraph

```ts
import { capture } from '@lanefoundry/gatelane-sdk'

// Wrap the model invocation inside your graph node
async function myNode(state: GraphState) {
  const result = await capture({
    prompt: state.messages.map(m => ({ role: m.role, content: m.content })),
    model: 'claude-sonnet-4',
    metadata: { node: 'myNode', threadId: state.threadId },
  }, () => model.invoke(state.messages))
  return { messages: [...state.messages, result] }
}
```


## Coexisting with existing observability

gatelane is complementary to tracing tools, not a replacement:

| Concern | Langfuse / LangSmith / Datadog | gatelane |
|---|---|---|
| Real-time trace visualization | ✅ | ❌ |
| Per-span scoring & debugging | ✅ | ❌ |
| Replay queries against new model | ❌ | ✅ |
| Red-team injection scans | ❌ | ✅ |
| Automated promote/rollback | ❌ | ✅ |
| Content-addressed dataset freezing | ❌ | ✅ |

Both can coexist — `capture()` wraps the LLM call, your tracing tool instruments the pipeline. They observe different layers.


## Checklist

- [ ] Identify the LLM choke point in your app
- [ ] Install the SDK
- [ ] Choose and configure a storage adapter
- [ ] Wrap the choke point with `capture()`
- [ ] Verify captures are recorded (InMemory → log count; HTTP → check Worker)
- [ ] Write a query list or use captured data for eval
- [ ] Run `gatelane eval` + `compare` before your next model change
- [ ] Run `gatelane attack` against your public endpoints
- [ ] Add eval to CI (optional, but recommended)

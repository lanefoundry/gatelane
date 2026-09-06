# gatelane-sdk (Python)

Capture SDK + type hints for the [gatelane](https://github.com/lanefoundry/gatelane)
promotion gate. Thin HTTP transport to a gatelane Worker; mirrors the JS SDK
shape 1:1 where possible and uses Python-native idioms where it can't.

## Install

```bash
pip install gatelane-sdk
```

Python 3.9+.

## Quick start

```python
import asyncio
from gatelane_sdk import (
    HttpStorage,
    capture,
    capture_session,
    CaptureMetadata,
)

async def main():
    # Option 1: context manager (recommended — auto-closes the HTTP client)
    async with capture_session(
        endpoint="https://gatelane.example.workers.dev",
        token="<your-capture-token>",
    ):
        result = await capture(
            prompt=[{"role": "user", "content": "hello"}],
            coro=lambda: call_openai("hello"),
            model="gpt-4o",
            metadata=CaptureMetadata(trace_id="trace-123", agent_version="v1"),
        )

    # Option 2: install once globally
    from gatelane_sdk import set_storage
    set_storage(HttpStorage(
        endpoint="https://gatelane.example.workers.dev",
        token="<your-capture-token>",
    ))
    result = await capture(
        prompt=[{"role": "user", "content": "hello"}],
        coro=lambda: call_openai("hello"),
    )

asyncio.run(main())
```

The SDK never raises on capture-write failure. A flaky network must
not turn into a broken agent — failed writes are logged to stderr and
the original call's return value is delivered to the caller unchanged.

## API parity with `@lanefoundry/gatelane-sdk`

| JS SDK | Python SDK | Notes |
|---|---|---|
| `capture(input, call, options)` | `capture(*, prompt, coro, model, metadata, span_kind, dry_run)` | kwargs-only; explicit keyword arguments |
| `withCapture(fn)` | `with_capture(fn)` | snake_case; decorators preserve the same call shape |
| `setStorage(adapter)` | `set_storage(adapter)` | module-level singleton |
| `new HttpStorage({...})` | `HttpStorage(...)` | keyword-only constructor |
| `HttpStorage.write()` returns `WriteResult` | `HttpStorage.write()` returns `WriteResult` | same field names |
| `InMemoryStorage` | `InMemoryStorage` | same semantics |
| `CaptureMetadata` | `CaptureMetadata` | `@dataclass(frozen=True, slots=True)` |
| `CapturedCall` | `CapturedCall` | same field set |

Drift between the JS and Python SDK surfaces is enforced by
`tools/check-sdk-parity.mjs` in the repo root. **Do not add a public
symbol to one SDK without adding the equivalent to the other.**

## Async-first

The SDK is async by default. This is intentional: every modern agent
runtime (LangGraph, OpenAI Agents SDK, Anthropic tool use) is async.
For legacy sync call sites, wrap with `asyncio.run(coro)` or use the
`requests`-backed sync adapter under the `sync` extra.

## Development

```bash
cd packages/gatelane-sdk-py
python -m pip install -e ".[dev]"
pytest
ruff check src tests
mypy src/gatelane_sdk
```

## License

Apache-2.0 — same as the rest of gatelane.
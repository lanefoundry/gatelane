"""Capture SDK — one-line instrumentation for agent calls.

Mirrors `packages/gatelane-sdk/src/capture.ts`. Wraps an LLM/tool/judge
call so gatelane can observe (and later replay) it. Records go through
the active StorageAdapter (in-memory by default; HTTP via HttpStorage
for production; a filesystem adapter is reserved for local dev).

Example
-------
```python
import asyncio
from gatelane_sdk import HttpStorage, capture, CaptureMetadata, set_storage

set_storage(HttpStorage(
    endpoint="https://gatelane.example.workers.dev",
    token="<your-capture-token>",
))

async def call_openai(prompt: str) -> str:
    return await capture(
        prompt=[{"role": "user", "content": prompt}],
        model="gpt-4o",
        metadata=CaptureMetadata(trace_id="trace-123", agent_version="v1"),
        coro=lambda: openai_client.chat(prompt),
    )

asyncio.run(call_openai("hello world"))
```
"""
from __future__ import annotations

import os
import sys
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Sequence
from contextlib import asynccontextmanager
from typing import Any, Callable, TypeVar, overload

from .storage import InMemoryStorage
from .types import CapturedCall, CaptureMetadata, ChatMessage, StorageAdapter

# --- module-level active storage ------------------------------------------

_active_storage: StorageAdapter = InMemoryStorage()


def set_storage(adapter: StorageAdapter) -> StorageAdapter:
    """Replace the active storage backend. Returns the previous one.

    Tests use this to install a fresh InMemoryStorage per case.
    """
    global _active_storage
    previous = _active_storage
    _active_storage = adapter
    return previous


def get_storage() -> StorageAdapter:
    """Get the active storage backend."""
    return _active_storage


# --- core capture ----------------------------------------------------------

async def capture(
    *,
    prompt: Sequence[ChatMessage],
    coro: Callable[[], Awaitable[Any]],
    model: str | None = None,
    metadata: CaptureMetadata | None = None,
    span_kind: str | None = None,
    dry_run: bool = False,
) -> Any:
    """Run `coro()` and capture the call.

    Parameters mirror the JS `capture()` shape 1:1 so the parity check
    script can flag accidental divergence. Field names that look similar
    across both SDKs are deliberate.

    If `dry_run=True`, the storage write is skipped — useful for SDK
    validation in production where you want to observe without writing.

    A storage failure does NOT propagate to the caller. Captures are an
    observability primitive, not a gating one; a flaky network must not
    turn into a broken agent.
    """
    metadata = metadata or CaptureMetadata()
    started_at = _utc_now_iso()
    start_perf = time.perf_counter()
    output = await coro()
    latency_ms = time.perf_counter() - start_perf
    completed_at = _utc_now_iso()

    if not dry_run:
        record = CapturedCall(
            id=str(uuid.uuid4()),
            prompt=tuple(prompt),
            response=output,
            started_at=started_at,
            completed_at=completed_at,
            cost_usd=0.0,           # real impl reads from model registry
            latency_ms=latency_ms,
            span_kind=span_kind,
            model=model,
            metadata=metadata,
        )
        try:
            await _active_storage.write(record)
        except Exception as exc:  # noqa: BLE001 — observability; do not propagate
            _log_capture_failure(record.id, exc)

    return output


F = TypeVar("F", bound=Callable[..., Awaitable[Any]])


@overload
def with_capture(fn: F) -> F: ...


@overload
def with_capture(*, span_kind: str | None = None) -> Callable[[F], F]: ...


def with_capture(
    fn: F | None = None,
    *,
    span_kind: str | None = None,
) -> F | Callable[[F], F]:
    """Wrap an async function so every call is captured.

    Usable as both a bare decorator and a parametrised decorator:

        @with_capture
        async def agent(q): ...

        @with_capture(span_kind="gate.replay")
        async def agent(q): ...

    Sugar over `capture()` for the common case where the agent's I/O is
    encapsulated in a function.
    """
    def decorator(func: F) -> F:
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            return await capture(
                prompt=[],
                coro=lambda: func(*args, **kwargs),
                span_kind=span_kind,
                metadata=CaptureMetadata(extra={"arg_count": len(args)}),
            )
        return wrapper  # type: ignore[return-value]  # wrapper is a decorated F

    if fn is not None:
        return decorator(fn)
    return decorator


@asynccontextmanager
async def capture_session(
    *,
    endpoint: str | None = None,
    token: str | None = None,
    storage: StorageAdapter | None = None,
) -> AsyncIterator[StorageAdapter]:
    """Context manager that swaps in an HttpStorage for the duration of the block.

    Mirrors the JS `setStorage(new HttpStorage({...}))` one-time setup pattern.
    On exit, restores the previous active storage and closes the
    HttpStorage client.

    Parameters
    ----------
    endpoint
        Defaults to `GATELANE_ENDPOINT` env var.
    token
        Defaults to `GATELANE_CAPTURE_TOKEN` env var. Must be ≥ 32 chars.
    storage
        Pass an existing StorageAdapter instead of constructing one.
        """
    if storage is None:
        from .storage import HttpStorage  # avoid cycle
        storage = HttpStorage(
            endpoint=endpoint or os.environ.get("GATELANE_ENDPOINT", ""),
            token=token or os.environ.get("GATELANE_CAPTURE_TOKEN", ""),
        )

    previous = set_storage(storage)
    try:
        yield storage
    finally:
        set_storage(previous)
        if hasattr(storage, "aclose"):
            await storage.aclose()


# --- helpers ---------------------------------------------------------------

def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _log_capture_failure(record_id: str, exc: BaseException) -> None:
    print(
        f"[gatelane] capture write failed (record id={record_id}): {exc}",
        file=sys.stderr,
    )

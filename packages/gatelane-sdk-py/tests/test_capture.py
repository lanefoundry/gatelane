"""Tests for the capture SDK. Mock the HTTP transport via `respx`.

Run with:
    cd packages/gatelane-sdk-py
    python -m pip install -e ".[dev]"
    pytest
"""
from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from gatelane_sdk import (
    CapturedCall,
    CaptureMetadata,
    HttpStorage,
    InMemoryStorage,
    capture,
    capture_session,
    get_storage,
    set_storage,
    with_capture,
)

# -- capture() --------------------------------------------------------------

@pytest.mark.asyncio
async def test_capture_invokes_coroutine_and_returns_output():
    storage = InMemoryStorage()
    set_storage(storage)

    async def run() -> str:
        return await capture(
            prompt=[{"role": "user", "content": "hello"}],
            coro=lambda: asyncio.sleep(0, result="hi"),
            model="gpt-4o",
            metadata=CaptureMetadata(trace_id="trace-1"),
        )

    out = await run()
    assert out == "hi"

    records = await storage.list()
    assert len(records) == 1
    r = records[0]
    assert r.response == "hi"
    assert r.model == "gpt-4o"
    assert r.metadata.trace_id == "trace-1"
    assert r.latency_ms >= 0


@pytest.mark.asyncio
async def test_capture_dry_run_skips_write():
    storage = InMemoryStorage()
    set_storage(storage)

    async def run() -> int:
        return await capture(
            prompt=[],
            coro=lambda: asyncio.sleep(0, result=42),
            dry_run=True,
        )

    out = await run()
    assert out == 42
    assert await storage.list() == []


@pytest.mark.asyncio
async def test_capture_does_not_propagate_storage_failure(capfd):
    class FailingStorage(InMemoryStorage):
        async def write(self, record: CapturedCall):  # type: ignore[override]
            raise RuntimeError("simulated transport failure")

    set_storage(FailingStorage())

    async def run() -> str:
        return await capture(
            prompt=[],
            coro=lambda: asyncio.sleep(0, result="still-returned"),
        )

    # capture must NOT raise — observability is fire-and-await.
    out = await run()
    assert out == "still-returned"

    err = capfd.readouterr().err
    assert "capture write failed" in err
    assert "simulated transport failure" in err


@pytest.mark.asyncio
async def test_with_capture_wraps_async_function():
    storage = InMemoryStorage()
    set_storage(storage)

    @with_capture(span_kind="gate.replay")
    async def my_agent(question: str) -> str:
        return f"answer to: {question}"

    out = await my_agent("ping")
    assert out == "answer to: ping"

    records = await storage.list()
    assert len(records) == 1
    assert records[0].span_kind == "gate.replay"


# -- HttpStorage ------------------------------------------------------------

@pytest.mark.asyncio
async def test_http_storage_writes_to_capture_endpoint():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content.decode("utf-8")
        return httpx.Response(
            201,
            json={"id": "capt-1", "stored_at": "2026-09-06T00:00:00Z", "traceId": "trace-1"},
        )

    with respx.mock(base_url="https://gatelane.example.workers.dev") as mock:
        mock.post("/v1/capture").mock(side_effect=handler)

        async with HttpStorage(
            endpoint="https://gatelane.example.workers.dev",
            token="super-secret-token-32-chars-min",
        ) as storage:
            record = CapturedCall(
                id="rec-1",
                prompt=({"role": "user", "content": "hi"},),
                response={"text": "hello"},
                started_at="2026-09-06T00:00:00Z",
                completed_at="2026-09-06T00:00:01Z",
                cost_usd=0.001,
                latency_ms=1000.0,
                span_kind="gate.replay",
                model="gpt-4o",
            )
            result = await storage.write(record)

    assert result.id == "capt-1"
    assert result.backend.startswith("http(")

    body = captured["body"]
    assert "rec-1" in body
    assert "gpt-4o" in body
    assert captured["headers"]["authorization"] == "Bearer super-secret-token-32-chars-min"
    assert captured["headers"]["x-gatelane-span-kind"] == "gate.replay"


@pytest.mark.asyncio
async def test_http_storage_retries_on_5xx_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503, json={"error": "transient"})
        return httpx.Response(201, json={"id": "capt-3", "stored_at": "2026-09-06T00:00:00Z"})

    with respx.mock(base_url="https://gatelane.example.workers.dev") as mock:
        mock.post("/v1/capture").mock(side_effect=handler)
        async with HttpStorage(
            endpoint="https://gatelane.example.workers.dev",
            token="super-secret-token-32-chars-min",
            initial_backoff_ms=10,  # keep test fast
        ) as storage:
            record = CapturedCall(
                id="rec-1",
                prompt=(),
                response=None,
                started_at="2026-09-06T00:00:00Z",
                completed_at="2026-09-06T00:00:01Z",
                cost_usd=0.0,
                latency_ms=1.0,
            )
            result = await storage.write(record)

    assert calls["n"] == 3
    assert result.id == "capt-3"


@pytest.mark.asyncio
async def test_http_storage_does_not_retry_on_4xx():
    with respx.mock(base_url="https://gatelane.example.workers.dev") as mock:
        route = mock.post("/v1/capture").mock(
            return_value=httpx.Response(401, json={"error": "unauthorized"})
        )

        async with HttpStorage(
            endpoint="https://gatelane.example.workers.dev",
            token="bad-token-but-long-enough",
        ) as storage:
            record = CapturedCall(
                id="rec-1",
                prompt=(),
                response=None,
                started_at="2026-09-06T00:00:00Z",
                completed_at="2026-09-06T00:00:01Z",
                cost_usd=0.0,
                latency_ms=1.0,
            )
            with pytest.raises(RuntimeError, match="rejected"):
                await storage.write(record)

        assert route.call_count == 1


# -- capture_session --------------------------------------------------------

@pytest.mark.asyncio
async def test_capture_session_restores_previous_storage():
    # Install a known adapter; capture_session must restore exactly this one.
    known = InMemoryStorage()
    set_storage(known)

    with respx.mock(base_url="https://gatelane.example.workers.dev") as mock:
        mock.post("/v1/capture").mock(
            return_value=httpx.Response(201, json={"id": "capt-1", "stored_at": "now"})
        )

        async with capture_session(
            endpoint="https://gatelane.example.workers.dev",
            token="super-secret-token-32-chars-min",
        ) as http_storage:
            assert get_storage() is http_storage
            await capture(prompt=[], coro=lambda: asyncio.sleep(0, result="x"))

    # previous storage restored
    assert get_storage() is known

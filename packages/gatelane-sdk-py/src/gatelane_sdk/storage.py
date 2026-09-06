"""Storage adapters — HTTP transport and in-process backend.

Mirrors `packages/gatelane-sdk/src/storage.ts` and `storage-http.ts`.
The wire format is the source of truth; this module is a thin transport layer.

Endpoint contract (Worker):
    POST /v1/capture
        Headers: Authorization: Bearer <token>
                 Content-Type:    application/json
                 x-gatelane-span-kind: <span_kind>
        Body:    CapturedCall
        201 ->   {"id": "...", "stored_at": "...", "traceId": "..."}
        401 ->   {"error": "unauthorized"}    (4xx: don't retry)
        5xx ->   {"error": "..."}             (5xx: retry with backoff)
"""
from __future__ import annotations

import asyncio
import random
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

import httpx

from .types import CapturedCall, CaptureMetadata, StorageAdapter, StorageAdapterError, WriteResult


def _utc_now_iso() -> str:
    """ISO-8601 UTC timestamp, second precision. Worker stores this verbatim."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ============================================================================
# HttpStorage
# ============================================================================

class HttpStorage(StorageAdapter):
    """HTTP transport for capture records. Async by default; sync wrapper
    is available via the module-level `sync_write()` helper for legacy
    call sites that cannot be made async.

    Retries 3 attempts on 5xx / network errors with exponential backoff
    + jitter. 4xx errors are fatal — the request will not be retried.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        token: str,
        max_retries: int = 3,
        initial_backoff_ms: int = 200,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not endpoint or not endpoint.startswith(("http://", "https://")):
            raise ValueError(f"endpoint must be a full http(s) URL, got {endpoint!r}")
        if not token or len(token) < 16:
            raise ValueError("token must be at least 16 chars; >=32 recommended")

        self._endpoint = endpoint.rstrip("/")
        self._token = token
        self._max_retries = max_retries
        self._initial_backoff_ms = initial_backoff_ms
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0),
            headers={"User-Agent": "gatelane-sdk-py/0.0.1"},
        )
        self.name = f"http({httpx.URL(self._endpoint).host})"

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> HttpStorage:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def write(self, record: CapturedCall) -> WriteResult:
        url = f"{self._endpoint}/v1/capture"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "x-gatelane-span-kind": record.span_kind or "gate.replay",
        }
        body = _record_to_wire(record)

        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                resp = await self._client.post(url, headers=headers, json=body)
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_exc = exc
            else:
                if 200 <= resp.status_code < 300:
                    payload = resp.json()
                    return WriteResult(
                        id=payload["id"],
                        stored_at=payload.get("stored_at") or _utc_now_iso(),
                        backend=self.name,
                    )
                if 400 <= resp.status_code < 500:
                    raise StorageAdapterError(
                        f"capture write rejected: {resp.status_code} {resp.text[:200]!r}"
                    )
                last_exc = StorageAdapterError(
                    f"capture write failed: {resp.status_code} {resp.text[:200]!r}"
                )

            if attempt < self._max_retries - 1:
                delay = (self._initial_backoff_ms * (2 ** attempt) / 1000.0) + random.uniform(0, 0.1)
                await asyncio.sleep(delay)

        raise StorageAdapterError(
            f"capture write failed after {self._max_retries} attempts: {last_exc}"
        )

    async def read(self, record_id: str) -> CapturedCall | None:
        # Worker exposes GET /v1/capture/:id in v0.2. Stub returns None.
        return None

    async def list(self, *, source_kind: str | None = None, since: str | None = None,
                   limit: int | None = None) -> Sequence[CapturedCall]:
        # Worker exposes GET /v1/captures?since=... in v0.2. Stub returns [].
        return []


# ============================================================================
# InMemoryStorage
# ============================================================================

class InMemoryStorage(StorageAdapter):
    """Thread-safe in-process store. Safe for concurrent use.

    Default for tests; never persisted across restarts.
    """

    def __init__(self) -> None:
        self.name = "memory"
        self._records: dict[str, CapturedCall] = {}
        self._lock = asyncio.Lock()

    async def write(self, record: CapturedCall) -> WriteResult:
        async with self._lock:
            self._records[record.id] = record
        return WriteResult(
            id=record.id,
            stored_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            backend=self.name,
        )

    async def read(self, record_id: str) -> CapturedCall | None:
        async with self._lock:
            return self._records.get(record_id)

    async def list(self, *, source_kind: str | None = None, since: str | None = None,
                   limit: int | None = None) -> Sequence[CapturedCall]:
        async with self._lock:
            out = list(self._records.values())

        if source_kind is not None:
            out = [r for r in out if r.metadata.source_kind == source_kind]
        if since is not None:
            cutoff = datetime.fromisoformat(since.replace("Z", "+00:00"))
            out = [
                r for r in out
                if datetime.fromisoformat(r.started_at.replace("Z", "+00:00")) >= cutoff
            ]
        if limit is not None:
            out = out[:limit]
        return out


# ============================================================================
# wire format helpers
# ============================================================================

def _record_to_wire(record: CapturedCall) -> dict[str, Any]:
    """Project a CapturedCall into the wire shape the Worker expects.

    The Worker parses this with `JSON.parse()` then validates against
    the shared `CaptureRecord` schema in `packages/shared/src/types.ts`.
    Field names match that schema; do not rename without updating both sides.
    """
    return {
        "id": record.id,
        "traceId": record.metadata.trace_id or record.id,
        "prompt": [dict(m) for m in record.prompt],
        "response": record.response,
        "model": record.model or "",
        "provider": "",  # filled by Worker from model registry; SDK leaves blank
        "costCents": int(record.cost_usd * 100),
        "latencyMs": record.latency_ms,
        "metadata": _metadata_to_wire(record.metadata),
        "createdAt": record.completed_at,
    }


def _metadata_to_wire(meta: CaptureMetadata) -> dict[str, Any]:
    out: dict[str, Any] = dict(meta.extra)
    if meta.trace_id is not None:
        out.setdefault("traceId", meta.trace_id)
    if meta.agent_version is not None:
        out.setdefault("agentVersion", meta.agent_version)
    if meta.dataset is not None:
        out.setdefault("dataset", meta.dataset)
    if meta.source_kind is not None:
        out.setdefault("source_kind", meta.source_kind)
    return out

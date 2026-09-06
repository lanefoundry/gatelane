"""Public types for the gatelane capture SDK.

Mirrors `packages/gatelane-sdk/src/capture.ts` and `storage.ts`. Keep this
file's surface area synchronized with the JS SDK — the parity check script
(see `tools/check-sdk-parity.mjs` in the repo root) enforces it.
"""
from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

if sys.version_info >= (3, 10):
    from typing import TypeAlias
else:  # pragma: no cover
    from typing_extensions import TypeAlias

# --- wire types -------------------------------------------------------------

ChatRole = Literal["system", "user", "assistant", "tool"]

ChatMessage: TypeAlias = Mapping[str, str]
"""Minimal chat message shape: {role, content}. Provider-specific extras
are dropped at the boundary; the SDK treats content as opaque text."""


@dataclass(frozen=True, slots=True)
class CaptureMetadata:
    """Free-form metadata attached to every capture record.

    Reserved keys (used by the engine):
    - traceId:      canonical trace id (string)
    - agentVersion: agent git SHA / version
    - dataset:      dataset slug if this call is a replay source
    - source_kind:  one of "gate.replay", "gate.compare", "gate.promote",
                    "redteam.attack", "redteam.judge"
    """

    trace_id: str | None = None
    agent_version: str | None = None
    dataset: str | None = None
    source_kind: str | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class CapturedCall:
    """A single LLM/tool/judge call, captured at the call site."""

    id: str
    prompt: Sequence[ChatMessage]
    response: Any
    started_at: str
    completed_at: str
    cost_usd: float
    latency_ms: float
    span_kind: str | None = None
    model: str | None = None
    metadata: CaptureMetadata = field(default_factory=CaptureMetadata)


@dataclass(frozen=True, slots=True)
class WriteResult:
    """Server response after a successful capture write."""

    id: str
    stored_at: str
    backend: str


# --- storage adapter contract ----------------------------------------------

StorageAdapterError = RuntimeError


class StorageAdapter:
    """Abstract storage backend. All methods must be safe under concurrent use."""

    name: str

    async def write(self, record: CapturedCall) -> WriteResult:  # pragma: no cover - interface
        raise NotImplementedError

    async def read(self, record_id: str) -> CapturedCall | None:  # pragma: no cover - interface
        raise NotImplementedError

    async def list(self, *, source_kind: str | None = None, since: str | None = None,
                   limit: int | None = None) -> Sequence[CapturedCall]:  # pragma: no cover
        raise NotImplementedError

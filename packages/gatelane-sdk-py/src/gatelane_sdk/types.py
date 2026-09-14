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
class ToolCall:
    """A tool/function call made by the assistant."""

    id: str
    name: str
    arguments: str  # JSON string


@dataclass(frozen=True, slots=True)
class TurnError:
    """Error info attached to a failed turn."""

    type: str
    message: str
    stack: str | None = None


@dataclass(frozen=True, slots=True)
class Turn:
    """A single step in a multi-turn agent trace.

    Flat turns array is the primary representation for eval/replay.
    span_id + parent_span_id overlay a nested tree for OTel/APM export.

    Mirrors `Turn` in `packages/gatelane-sdk/src/capture.ts`.
    """

    role: ChatRole
    content: str | None = None
    tool_calls: Sequence[ToolCall] = field(default_factory=tuple)
    tool_call_id: str | None = None
    name: str | None = None

    # Error tracking
    status: Literal["ok", "error", "timeout"] | None = None
    error: TurnError | None = None

    # Nested span overlay (OTel-compatible)
    span_id: str | None = None
    parent_span_id: str | None = None
    span_kind: Literal["llm", "tool", "agent", "retriever", "guardrail"] | None = None
    started_at: str | None = None
    completed_at: str | None = None
    cost_usd: float | None = None
    latency_ms: float | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    model: str | None = None


@dataclass(frozen=True, slots=True)
class CaptureMetadata:
    """Free-form metadata attached to every capture record.

    Reserved keys (used by the engine):
    - traceId:      canonical trace id (string)
    - agentVersion: agent git SHA / version
    - dataset:      dataset slug if this call is a replay source
    - source_kind:  one of "gate.replay", "gate.compare", "gate.pass",
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
    turns: Sequence[Turn] = field(default_factory=tuple)
    outcome: Literal["success", "partial_failure", "failure"] | None = None
    errors: Sequence[Mapping[str, Any]] = field(default_factory=tuple)


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

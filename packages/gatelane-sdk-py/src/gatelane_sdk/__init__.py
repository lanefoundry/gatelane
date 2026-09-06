"""gatelane-sdk — capture SDK + type hints for the gatelane promotion gate.

Public API surface (matches JS SDK 1:1 where possible):

    set_storage(adapter)          replace active storage backend
    get_storage()                 get the active backend
    capture(...)                  run a coroutine and capture the call
    with_capture(fn)              wrap an async function so every call is captured
    capture_session(...)          context manager that swaps in HttpStorage

    HttpStorage(...)              transport to a gatelane Worker
    InMemoryStorage()             default; tests + local dev
    StorageAdapter                abstract base
    CaptureMetadata, CapturedCall, WriteResult, ChatMessage
"""
from .capture import capture, capture_session, get_storage, set_storage, with_capture
from .storage import HttpStorage, InMemoryStorage
from .types import (
    CapturedCall,
    CaptureMetadata,
    ChatMessage,
    StorageAdapter,
    StorageAdapterError,
    WriteResult,
)

__version__ = "0.0.1-dev"

__all__ = [
    # core
    "capture",
    "capture_session",
    "with_capture",
    "set_storage",
    "get_storage",
    # adapters
    "HttpStorage",
    "InMemoryStorage",
    "StorageAdapter",
    "StorageAdapterError",
    # types
    "CapturedCall",
    "CaptureMetadata",
    "ChatMessage",
    "WriteResult",
]

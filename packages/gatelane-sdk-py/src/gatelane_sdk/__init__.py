"""gatelane-sdk — capture SDK + LLM providers for the gatelane promotion gate.

Public API surface (matches JS SDK 1:1 where possible):

    # Capture
    set_storage(adapter)          replace active storage backend
    get_storage()                 get the active backend
    capture(...)                  run a coroutine and capture the call
    with_capture(fn)              wrap an async function so every call is captured
    capture_session(...)          context manager that swaps in HttpStorage

    # Providers
    make_caller(provider, model)  build an LLMCaller for a provider
    parse_provider_model(ref)     parse "provider:model" syntax

    # Adapters & Types
    HttpStorage(...)              transport to a gatelane Worker
    InMemoryStorage()             default; tests + local dev
    StorageAdapter                abstract base
    CaptureMetadata, CapturedCall, WriteResult, ChatMessage
"""
from .capture import capture, capture_session, get_storage, set_storage, with_capture
from .providers import (
    PROVIDER_REGISTRY,
    SUPPORTED_PROVIDERS,
    AnthropicCaller,
    GoogleCaller,
    LLMCaller,
    LLMResponse,
    MockCaller,
    OpenAIChatCaller,
    make_caller,
    parse_provider_model,
)
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
    # providers
    "make_caller",
    "parse_provider_model",
    "PROVIDER_REGISTRY",
    "SUPPORTED_PROVIDERS",
    "LLMCaller",
    "LLMResponse",
    "MockCaller",
    "OpenAIChatCaller",
    "AnthropicCaller",
    "GoogleCaller",
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

"""Provider registry and LLM caller abstraction.

Mirrors `packages/gatelane-engine/src/llm.ts` PROVIDER_REGISTRY and callers.
Supports the same provider:model syntax as the TypeScript CLI.

Example
-------
```python
from gatelane_sdk.providers import make_caller, parse_provider_model

# Auto-reads GROQ_API_KEY from env / .env
caller = make_caller("groq", "llama-3.1-70b-versatile")
response = await caller.call(messages=[{"role": "user", "content": "hello"}])

# Parse provider:model syntax
provider, model = parse_provider_model("openai:gpt-4o", default_provider="mock")
# → ("openai", "gpt-4o")
```
"""
from __future__ import annotations

import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx

# ── Provider Registry ─────────────────────────────────────────────────

@dataclass(frozen=True)
class ProviderEntry:
    env_key: str
    base_url: str
    default_model: str
    env_base_url: str | None = None
    key_optional: bool = False


PROVIDER_REGISTRY: dict[str, ProviderEntry] = {
    "openai": ProviderEntry(
        env_key="OPENAI_API_KEY",
        env_base_url="OPENAI_BASE_URL",
        base_url="https://api.openai.com",
        default_model="gpt-4o-mini",
    ),
    "anthropic": ProviderEntry(
        env_key="ANTHROPIC_API_KEY",
        env_base_url="ANTHROPIC_BASE_URL",
        base_url="https://api.anthropic.com",
        default_model="claude-3-5-haiku",
    ),
    "google": ProviderEntry(
        env_key="GOOGLE_API_KEY",
        base_url="https://generativelanguage.googleapis.com",
        default_model="gemini-2.5-flash",
    ),
    "groq": ProviderEntry(
        env_key="GROQ_API_KEY",
        base_url="https://api.groq.com/openai",
        default_model="llama-3.1-70b-versatile",
    ),
    "openrouter": ProviderEntry(
        env_key="OPENROUTER_API_KEY",
        base_url="https://openrouter.ai/api",
        default_model="openai/gpt-4o-mini",
    ),
    "cloudflare": ProviderEntry(
        env_key="CLOUDFLARE_API_TOKEN",
        base_url="",
        default_model="@cf/meta/llama-3.1-8b-instruct",
    ),
    "ollama": ProviderEntry(
        env_key="OLLAMA_API_KEY",
        env_base_url="OLLAMA_BASE_URL",
        base_url="http://localhost:11434/v1",
        default_model="llama3.1",
        key_optional=True,
    ),
}

SUPPORTED_PROVIDERS = ["mock", *PROVIDER_REGISTRY.keys()]


def parse_provider_model(
    candidate_ref: str,
    default_provider: str = "mock",
) -> tuple[str, str]:
    """Parse 'provider:model' into (provider, model).

    Falls back to default_provider if no colon prefix or prefix is not
    a known provider.
    """
    colon = candidate_ref.find(":")
    if colon == -1:
        return default_provider, candidate_ref
    prefix = candidate_ref[:colon]
    if prefix in PROVIDER_REGISTRY or prefix == "mock":
        return prefix, candidate_ref[colon + 1:]
    return default_provider, candidate_ref


# ── LLM Caller Abstraction ────────────────────────────────────────────

@dataclass
class LLMResponse:
    content: str
    cost_usd: float
    latency_ms: float
    tokens_in: int | None = None
    tokens_out: int | None = None
    finish_reason: str = "stop"
    raw: Any = None


class LLMCaller(ABC):
    provider: str

    @abstractmethod
    async def call(
        self,
        *,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float = 0,
        max_tokens: int = 4096,
    ) -> LLMResponse: ...


class MockCaller(LLMCaller):
    def __init__(self, quality: float = 0.8) -> None:
        self.provider = "mock"
        self.quality = quality

    async def call(self, *, messages: list[dict[str, str]], model: str | None = None,
                   temperature: float = 0, max_tokens: int = 4096) -> LLMResponse:
        import json
        content = json.dumps({"mock": True, "quality": self.quality, "messages": len(messages)})
        return LLMResponse(content=content, cost_usd=0.001, latency_ms=0.1)


class OpenAIChatCaller(LLMCaller):
    """OpenAI-compatible Chat Completions caller (also groq, openrouter, cloudflare, ollama)."""

    def __init__(self, *, api_key: str, base_url: str, default_model: str,
                 provider: str = "openai", timeout: float = 60.0) -> None:
        self.provider = provider
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._default_model = default_model
        self._timeout = timeout

    async def call(self, *, messages: list[dict[str, str]], model: str | None = None,
                   temperature: float = 0, max_tokens: int = 4096) -> LLMResponse:
        model = model or self._default_model
        body = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}

        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/v1/chat/completions",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._api_key}"},
                json=body,
            )
        latency_ms = (time.perf_counter() - start) * 1000

        if resp.status_code >= 400:
            return LLMResponse(content="", cost_usd=0, latency_ms=latency_ms, finish_reason="error",
                               raw={"status": resp.status_code, "error": resp.text[:500]})

        data = resp.json()
        choice = data.get("choices", [{}])[0]
        content = choice.get("message", {}).get("content", "")
        usage = data.get("usage", {})
        return LLMResponse(
            content=content, cost_usd=0, latency_ms=latency_ms,
            tokens_in=usage.get("prompt_tokens"), tokens_out=usage.get("completion_tokens"),
            finish_reason=choice.get("finish_reason", "stop"), raw=data,
        )


class AnthropicCaller(LLMCaller):
    def __init__(self, *, api_key: str, base_url: str = "https://api.anthropic.com",
                 default_model: str = "claude-3-5-haiku", timeout: float = 60.0) -> None:
        self.provider = "anthropic"
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._default_model = default_model
        self._timeout = timeout

    async def call(self, *, messages: list[dict[str, str]], model: str | None = None,
                   temperature: float = 0, max_tokens: int = 4096) -> LLMResponse:
        model = model or self._default_model
        system_msg = next((m["content"] for m in messages if m.get("role") == "system"), None)
        chat_msgs = [m for m in messages if m.get("role") != "system"]
        body: dict[str, Any] = {"model": model, "messages": chat_msgs, "max_tokens": max_tokens, "temperature": temperature}
        if system_msg:
            body["system"] = system_msg

        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/v1/messages",
                headers={"Content-Type": "application/json", "x-api-key": self._api_key, "anthropic-version": "2023-06-01"},
                json=body,
            )
        latency_ms = (time.perf_counter() - start) * 1000

        if resp.status_code >= 400:
            return LLMResponse(content="", cost_usd=0, latency_ms=latency_ms, finish_reason="error",
                               raw={"status": resp.status_code, "error": resp.text[:500]})

        data = resp.json()
        content = "".join(c.get("text", "") for c in data.get("content", []))
        usage = data.get("usage", {})
        return LLMResponse(
            content=content, cost_usd=0, latency_ms=latency_ms,
            tokens_in=usage.get("input_tokens"), tokens_out=usage.get("output_tokens"),
            finish_reason=data.get("stop_reason", "stop"), raw=data,
        )


class GoogleCaller(LLMCaller):
    def __init__(self, *, api_key: str, default_model: str = "gemini-2.5-flash",
                 timeout: float = 60.0) -> None:
        self.provider = "google"
        self._api_key = api_key
        self._default_model = default_model
        self._timeout = timeout

    async def call(self, *, messages: list[dict[str, str]], model: str | None = None,
                   temperature: float = 0, max_tokens: int = 4096) -> LLMResponse:
        model = model or self._default_model
        system_msg = next((m["content"] for m in messages if m.get("role") == "system"), None)
        contents = [
            {"role": "model" if m.get("role") == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages if m.get("role") != "system"
        ]
        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
        }
        if system_msg:
            body["systemInstruction"] = {"parts": [{"text": system_msg}]}

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self._api_key}"
        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, headers={"Content-Type": "application/json"}, json=body)
        latency_ms = (time.perf_counter() - start) * 1000

        if resp.status_code >= 400:
            return LLMResponse(content="", cost_usd=0, latency_ms=latency_ms, finish_reason="error",
                               raw={"status": resp.status_code, "error": resp.text[:500]})

        data = resp.json()
        candidates = data.get("candidates", [{}])
        content = "".join(p.get("text", "") for p in candidates[0].get("content", {}).get("parts", []))
        usage = data.get("usageMetadata", {})
        finish = candidates[0].get("finishReason", "STOP")
        return LLMResponse(
            content=content, cost_usd=0, latency_ms=latency_ms,
            tokens_in=usage.get("promptTokenCount"), tokens_out=usage.get("candidatesTokenCount"),
            finish_reason="length" if finish == "MAX_TOKENS" else "stop", raw=data,
        )


# ── Factory ───────────────────────────────────────────────────────────

def make_caller(provider: str, default_model: str = "") -> LLMCaller:
    """Build an LLMCaller for the given provider. Reads API keys from env.

    Raises ValueError if a required API key is missing.
    """
    if provider == "mock":
        return MockCaller()

    reg = PROVIDER_REGISTRY.get(provider)
    if reg is None:
        raise ValueError(f"unknown provider: {provider} (expected {', '.join(SUPPORTED_PROVIDERS)})")

    api_key = os.environ.get(reg.env_key) or ("ollama" if reg.key_optional else None)
    if not api_key:
        raise ValueError(f'provider "{provider}" requires {reg.env_key} in .env or environment')

    model = default_model or reg.default_model

    if provider == "anthropic":
        base_url = (os.environ.get(reg.env_base_url) if reg.env_base_url else None) or reg.base_url
        return AnthropicCaller(api_key=api_key, base_url=base_url, default_model=model)

    if provider == "google":
        return GoogleCaller(api_key=api_key, default_model=model)

    # OpenAI-compatible: openai, groq, openrouter, cloudflare, ollama
    base_url = (os.environ.get(reg.env_base_url) if reg.env_base_url else None) or reg.base_url

    if provider == "cloudflare":
        account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        if not account_id:
            raise ValueError('provider "cloudflare" requires CLOUDFLARE_ACCOUNT_ID in .env or environment')
        base_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai"

    return OpenAIChatCaller(api_key=api_key, base_url=base_url, default_model=model, provider=provider)

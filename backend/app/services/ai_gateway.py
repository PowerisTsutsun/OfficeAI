"""
AI Gateway — unified interface to all AI providers.
API keys are NEVER sent to the client. All provider calls happen here (server-side).
"""
from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class ChatMessage:
    role: Literal["user", "assistant", "system"]
    content: str


@dataclass
class StreamChunk:
    delta: str = ""
    finish_reason: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    error: str | None = None


@dataclass
class AdapterConfig:
    api_key: str
    base_url: str | None = None
    timeout: float = 60.0
    max_retries: int = 3


# ── Base adapter ─────────────────────────────────────────────────────────────

class BaseAdapter(ABC):
    def __init__(self, config: AdapterConfig):
        self.config = config
        self._client = httpx.AsyncClient(
            timeout=config.timeout,
            headers={"Authorization": f"Bearer {config.api_key}"},
        )

    @abstractmethod
    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        system: str | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        ...

    async def close(self) -> None:
        await self._client.aclose()


# ── OpenAI Adapter ────────────────────────────────────────────────────────────

class OpenAIAdapter(BaseAdapter):
    BASE_URL = "https://api.openai.com/v1"

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        system: str | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        payload_messages = []
        if system:
            payload_messages.append({"role": "system", "content": system})
        payload_messages.extend({"role": m.role, "content": m.content} for m in messages)

        payload: dict[str, Any] = {
            "model": model,
            "messages": payload_messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens

        base = self.config.base_url or self.BASE_URL
        tokens_in = tokens_out = 0

        async with self._client.stream(
            "POST",
            f"{base}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {self.config.api_key}"},
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield StreamChunk(error=f"OpenAI error {response.status_code}: {body[:200]}")
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break

                import json
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue

                usage = chunk.get("usage")
                if usage:
                    tokens_in = usage.get("prompt_tokens", 0)
                    tokens_out = usage.get("completion_tokens", 0)

                choices = chunk.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                finish = choices[0].get("finish_reason")
                content = delta.get("content", "")

                yield StreamChunk(
                    delta=content,
                    finish_reason=finish,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                )


# ── Anthropic Adapter ─────────────────────────────────────────────────────────

class AnthropicAdapter(BaseAdapter):
    BASE_URL = "https://api.anthropic.com/v1"
    API_VERSION = "2023-06-01"

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        system: str | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        import json

        # Anthropic separates system from messages
        anthropic_messages = [
            {"role": m.role, "content": m.content}
            for m in messages
            if m.role != "system"
        ]

        payload: dict[str, Any] = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens or 4096,
            "stream": True,
            "temperature": temperature,
        }
        if system:
            payload["system"] = system

        base = self.config.base_url or self.BASE_URL
        tokens_in = tokens_out = 0

        async with self._client.stream(
            "POST",
            f"{base}/messages",
            json=payload,
            headers={
                "x-api-key": self.config.api_key,
                "anthropic-version": self.API_VERSION,
                "content-type": "application/json",
            },
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield StreamChunk(error=f"Anthropic error {response.status_code}: {body[:200]}")
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]

                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue

                etype = event.get("type", "")

                if etype == "content_block_delta":
                    delta = event.get("delta", {})
                    yield StreamChunk(delta=delta.get("text", ""))

                elif etype == "message_delta":
                    usage = event.get("usage", {})
                    tokens_out = usage.get("output_tokens", tokens_out)

                elif etype == "message_start":
                    usage = event.get("message", {}).get("usage", {})
                    tokens_in = usage.get("input_tokens", 0)

                elif etype == "message_stop":
                    yield StreamChunk(
                        finish_reason="stop",
                        tokens_in=tokens_in,
                        tokens_out=tokens_out,
                    )


# ── Gemini Adapter ────────────────────────────────────────────────────────────

class GeminiAdapter(BaseAdapter):
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, config: AdapterConfig):
        self.config = config
        # Gemini uses API key as query param, NOT Bearer token header
        self._client = httpx.AsyncClient(timeout=config.timeout)

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        system: str | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        import json

        contents = []
        for m in messages:
            if m.role == "system":
                continue
            role = "user" if m.role == "user" else "model"
            contents.append({"role": role, "parts": [{"text": m.content}]})

        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
            },
        }
        if max_tokens:
            payload["generationConfig"]["maxOutputTokens"] = max_tokens
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}

        url = f"{self.BASE_URL}/models/{model}:streamGenerateContent?alt=sse&key={self.config.api_key}"
        tokens_in = tokens_out = 0

        async with self._client.stream("POST", url, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield StreamChunk(error=f"Gemini error {response.status_code}: {body[:200]}")
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]

                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue

                candidates = event.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    for part in parts:
                        if "text" in part:
                            yield StreamChunk(delta=part["text"])

                usage = event.get("usageMetadata", {})
                if usage:
                    tokens_in = usage.get("promptTokenCount", tokens_in)
                    tokens_out = usage.get("candidatesTokenCount", tokens_out)

            yield StreamChunk(
                finish_reason="stop",
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            )


# ── Gateway ───────────────────────────────────────────────────────────────────

class AIGateway:
    """
    Unified gateway to all AI providers.
    - Loads API keys from settings (which loads from secret manager in prod)
    - Handles retries with exponential backoff
    - Enforces per-request token limits
    """

    def __init__(self):
        self._adapters: dict[str, BaseAdapter] = {}
        self._init_adapters()

    def _init_adapters(self) -> None:
        if settings.OPENAI_API_KEY:
            self._adapters["openai"] = OpenAIAdapter(
                AdapterConfig(api_key=settings.OPENAI_API_KEY)
            )
        if settings.ANTHROPIC_API_KEY:
            self._adapters["anthropic"] = AnthropicAdapter(
                AdapterConfig(api_key=settings.ANTHROPIC_API_KEY)
            )
        if settings.GEMINI_API_KEY:
            self._adapters["gemini"] = GeminiAdapter(
                AdapterConfig(api_key=settings.GEMINI_API_KEY)
            )

    def get_adapter(self, provider: str) -> BaseAdapter:
        adapter = self._adapters.get(provider)
        if not adapter:
            raise ValueError(f"Provider '{provider}' is not configured or is disabled")
        return adapter

    async def stream_chat(
        self,
        provider: str,
        model: str,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        system: str | None = None,
        max_retries: int = 2,
    ) -> AsyncGenerator[StreamChunk, None]:
        """
        Stream a chat response with automatic retry on transient errors.
        Yields StreamChunk objects; caller handles SSE formatting.
        """
        adapter = self.get_adapter(provider)
        last_error: str | None = None

        for attempt in range(max_retries + 1):
            if attempt > 0:
                wait = min(2 ** attempt, 30)
                logger.warning("Retry %d/%d for %s/%s, waiting %ds", attempt, max_retries, provider, model, wait)
                await asyncio.sleep(wait)

            try:
                async for chunk in adapter.stream_chat(
                    model,
                    messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    system=system,
                ):
                    if chunk.error and attempt < max_retries:
                        last_error = chunk.error
                        # Retryable if provider error (5xx or rate limit)
                        if "429" in chunk.error or "5" in chunk.error[:3]:
                            break
                    yield chunk
                else:
                    return  # Completed without error
            except httpx.TimeoutException:
                last_error = "Request timed out"
                if attempt == max_retries:
                    yield StreamChunk(error=last_error)
            except Exception as e:
                last_error = str(e)
                logger.exception("AI provider error on attempt %d", attempt)
                if attempt == max_retries:
                    yield StreamChunk(error=f"Provider error: {last_error}")


# Singleton instance
_gateway: AIGateway | None = None


def get_gateway() -> AIGateway:
    global _gateway
    if _gateway is None:
        _gateway = AIGateway()
    return _gateway

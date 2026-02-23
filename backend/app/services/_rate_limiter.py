"""
Redis-backed sliding window rate limiter.
Falls back to in-memory for development without Redis.
"""
from __future__ import annotations

import time
from collections import defaultdict

try:
    import redis.asyncio as aioredis
    _REDIS_AVAILABLE = True
except ImportError:
    _REDIS_AVAILABLE = False

from app.config import get_settings

settings = get_settings()


class RateLimiter:
    def __init__(self) -> None:
        self._redis: "aioredis.Redis | None" = None
        self._local: dict[str, list[float]] = defaultdict(list)  # fallback
        self._redis_retry_after: float = 0.0

    async def _get_redis(self) -> "aioredis.Redis | None":
        if not _REDIS_AVAILABLE:
            return None
        now = time.time()
        if self._redis is None and now < self._redis_retry_after:
            return None
        if self._redis is None:
            try:
                self._redis = aioredis.from_url(
                    settings.REDIS_URL,
                    decode_responses=True,
                    socket_connect_timeout=settings.REDIS_CONNECT_TIMEOUT_SECONDS,
                    socket_timeout=settings.REDIS_CONNECT_TIMEOUT_SECONDS,
                )
                await self._redis.ping()
            except Exception:
                self._redis = None
                self._redis_retry_after = now + settings.REDIS_RETRY_COOLDOWN_SECONDS
        return self._redis

    async def check(self, key: str, *, limit: int, window: int) -> bool:
        """
        Sliding window rate limit check.
        Returns True if the request is allowed, False if rate limited.
        Increments the counter on each call.

        key    — unique identifier (e.g. "chat:user_id" or "magic_link_ip:1.2.3.4")
        limit  — max requests per window
        window — window size in seconds
        """
        redis = await self._get_redis()

        if redis:
            return await self._redis_check(redis, key, limit, window)
        else:
            return self._local_check(key, limit, window)

    async def _redis_check(
        self, redis: "aioredis.Redis", key: str, limit: int, window: int
    ) -> bool:
        now = time.time()
        full_key = f"rl:{key}"

        async with redis.pipeline(transaction=True) as pipe:
            # Remove expired entries
            pipe.zremrangebyscore(full_key, 0, now - window)
            # Count current entries
            pipe.zcard(full_key)
            # Add current request
            pipe.zadd(full_key, {str(now): now})
            # Set expiry
            pipe.expire(full_key, window + 1)
            results = await pipe.execute()

        current_count = results[1]
        return current_count < limit

    def _local_check(self, key: str, limit: int, window: int) -> bool:
        """In-memory fallback (development only)."""
        now = time.time()
        cutoff = now - window
        timestamps = [t for t in self._local[key] if t > cutoff]
        self._local[key] = timestamps

        if len(timestamps) >= limit:
            return False

        self._local[key].append(now)
        return True

    async def reset(self, key: str) -> None:
        """Reset a specific rate limit key (e.g., on successful auth)."""
        redis = await self._get_redis()
        if redis:
            await redis.delete(f"rl:{key}")
        else:
            self._local.pop(key, None)

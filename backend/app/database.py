"""
Async SQLAlchemy database setup with connection pooling.
"""
from __future__ import annotations

import ssl as _ssl
from collections.abc import AsyncGenerator
from typing import Annotated

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Add SSL for remote databases (Neon, RDS, etc.) — not needed for localhost
_connect_args: dict = {}
_local_hosts = ("localhost", "127.0.0.1", "host.docker.internal")
if not any(h in settings.DATABASE_URL for h in _local_hosts):
    _ssl_ctx = _ssl.create_default_context()
    _connect_args["ssl"] = _ssl_ctx

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args=_connect_args,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    pool_pre_ping=True,
    echo=settings.DEBUG,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


DbSession = Annotated[AsyncSession, "db"]

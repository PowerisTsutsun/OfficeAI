"""
SQLAlchemy ORM models — mirrors the PostgreSQL schema exactly.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def now_ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


# ── Users ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    email_domain: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    locked_reason: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mfa_secret_encrypted: Mapped[str | None] = mapped_column(Text)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    login_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = now_ts()
    updated_at: Mapped[datetime] = now_ts()

    quota: Mapped[UserQuota | None] = relationship("UserQuota", back_populates="user", uselist=False)
    preferences: Mapped[UserPreferences | None] = relationship("UserPreferences", back_populates="user", uselist=False)
    sessions: Mapped[list[UserSession]] = relationship("UserSession", back_populates="user")
    chat_sessions: Mapped[list[ChatSession]] = relationship("ChatSession", back_populates="user")


class UserQuota(Base):
    __tablename__ = "user_quotas"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    daily_token_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=100000)
    monthly_token_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=2000000)
    context_window_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=128000)
    max_concurrent_chats: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    daily_tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    monthly_tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    daily_reset_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    monthly_reset_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = now_ts()

    user: Mapped[User] = relationship("User", back_populates="quota")


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    preferred_provider: Mapped[str | None] = mapped_column(String(50))
    preferred_model: Mapped[str | None] = mapped_column(String(100))
    theme: Mapped[str] = mapped_column(String(50), nullable=False, default="system")
    accent_color: Mapped[str] = mapped_column(String(50), nullable=False, default="blue")
    font_size: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=15)
    reduced_motion: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    compact_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sidebar_width: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=240)
    created_at: Mapped[datetime] = now_ts()
    updated_at: Mapped[datetime] = now_ts()

    user: Mapped[User] = relationship("User", back_populates="preferences")


# ── Auth ─────────────────────────────────────────────────────────────────────

class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(255))
    device_name: Mapped[str | None] = mapped_column(String(500))
    platform: Mapped[str | None] = mapped_column(String(100))
    ip_address: Mapped[Any | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = now_ts()
    last_used_at: Mapped[datetime] = now_ts()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(255))
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4)

    user: Mapped[User] = relationship("User", back_populates="sessions")


class MagicLink(Base):
    __tablename__ = "magic_links"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    ip_address: Mapped[Any | None] = mapped_column(INET)
    created_at: Mapped[datetime] = now_ts()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


# ── AI Config ────────────────────────────────────────────────────────────────

class AIProvider(Base):
    __tablename__ = "ai_providers"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    secret_key_name: Mapped[str] = mapped_column(String(200), nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = now_ts()
    updated_at: Mapped[datetime] = now_ts()

    models: Mapped[list[AIModel]] = relationship("AIModel", back_populates="provider")


class AIModel(Base):
    __tablename__ = "ai_models"

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ai_providers.id"), nullable=False)
    model_id: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    context_window: Mapped[int] = mapped_column(Integer, nullable=False)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer)
    supports_vision: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_tools: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_beta: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cost_per_input_token: Mapped[float | None] = mapped_column(Numeric(16, 10))
    cost_per_output_token: Mapped[float | None] = mapped_column(Numeric(16, 10))
    feature_flags: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    sort_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = now_ts()
    updated_at: Mapped[datetime] = now_ts()

    provider: Mapped[AIProvider] = relationship("AIProvider", back_populates="models")


# ── Chat ─────────────────────────────────────────────────────────────────────

class ChatFolder(Base):
    __tablename__ = "chat_folders"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str | None] = mapped_column(String(50))
    icon: Mapped[str | None] = mapped_column(String(50))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = now_ts()
    updated_at: Mapped[datetime] = now_ts()

    sessions: Mapped[list[ChatSession]] = relationship("ChatSession", back_populates="folder")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    folder_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_folders.id", ondelete="SET NULL"))
    title: Mapped[str | None] = mapped_column(String(500))
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_ephemeral: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    system_prompt_enc: Mapped[str | None] = mapped_column(Text)
    system_prompt_iv: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    total_tokens_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = now_ts()
    updated_at: Mapped[datetime] = now_ts()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship("User", back_populates="chat_sessions")
    folder: Mapped[ChatFolder | None] = relationship("ChatFolder", back_populates="sessions")
    messages: Mapped[list[ChatMessage]] = relationship("ChatMessage", back_populates="session", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content_enc: Mapped[str] = mapped_column(Text, nullable=False)
    content_iv: Mapped[str] = mapped_column(Text, nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider: Mapped[str | None] = mapped_column(String(50))
    model: Mapped[str | None] = mapped_column(String(100))
    finish_reason: Mapped[str | None] = mapped_column(String(50))
    is_ephemeral: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    parent_msg_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_messages.id"))
    created_at: Mapped[datetime] = now_ts()

    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="messages")


# ── Prompt Templates ─────────────────────────────────────────────────────────

class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    is_company_template: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = now_ts()
    updated_at: Mapped[datetime] = now_ts()


# ── Audit ────────────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actor_email: Mapped[str | None] = mapped_column(String(255))
    actor_role: Mapped[str | None] = mapped_column(String(50))
    target_id: Mapped[str | None] = mapped_column(Text)
    target_type: Mapped[str | None] = mapped_column(String(100))
    ip_address: Mapped[Any | None] = mapped_column(INET)
    device_id: Mapped[str | None] = mapped_column(String(255))
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason_code: Mapped[str | None] = mapped_column(String(100))
    event_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, name="metadata")
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = now_ts()

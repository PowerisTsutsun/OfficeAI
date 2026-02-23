"""
Application configuration — loaded from environment variables.
All secrets come from environment (populated by secret manager in production).
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, EmailStr, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────────────────────
    APP_NAME: str = "Company AI Desktop"
    APP_ENV: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: list[str] = Field(default=["tauri://localhost"])

    # ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: str                   # postgresql+asyncpg://user:pass@host/db
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20

    # ── Redis ────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_CONNECT_TIMEOUT_SECONDS: float = 0.35
    REDIS_RETRY_COOLDOWN_SECONDS: int = 30

    # ── JWT ──────────────────────────────────────────────────────────────────
    JWT_PRIVATE_KEY: str                # PEM-encoded RS256 private key
    JWT_PUBLIC_KEY: str                 # PEM-encoded RS256 public key
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Encryption ───────────────────────────────────────────────────────────
    MASTER_ENCRYPTION_KEY: str          # 32-byte key, base64-encoded

    # ── AI Providers (fetched from secret manager in prod) ───────────────────
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    LOCAL_AI_BASE_URL: str = "http://localhost:11434/v1"
    LOCAL_AI_API_KEY: str = ""
    AI_PROVIDER_TIMEOUT_SECONDS: float = 20.0
    AI_PROVIDER_MAX_RETRIES: int = 0

    # ── Auth ─────────────────────────────────────────────────────────────────
    ALLOWED_EMAIL_DOMAINS: list[str] = Field(default=["company.com"])
    MAGIC_LINK_BASE_URL: str = "https://app.company.com"
    MAGIC_LINK_EXPIRE_MINUTES: int = 10

    # ── Email (for magic links) ───────────────────────────────────────────────
    SMTP_HOST: str = "smtp.company.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@company.com"

    # ── OIDC (optional SSO) ───────────────────────────────────────────────────
    OIDC_ISSUER: str = ""
    OIDC_CLIENT_ID: str = ""
    OIDC_CLIENT_SECRET: str = ""

    # ── Rate Limiting ─────────────────────────────────────────────────────────
    RATE_LIMIT_MAGIC_LINK_PER_IP: int = 5       # per 15 min
    RATE_LIMIT_MAGIC_LINK_PER_EMAIL: int = 3     # per 15 min
    RATE_LIMIT_CHAT_PER_USER: int = 60           # per min
    RATE_LIMIT_GLOBAL_PER_USER: int = 300        # per min

    # ── Audit ─────────────────────────────────────────────────────────────────
    AUDIT_WEBHOOK_URL: str = ""         # optional SIEM webhook
    AUDIT_WRITER_DATABASE_URL: str = "" # separate conn for audit_writer user

    # ── Updates ───────────────────────────────────────────────────────────────
    UPDATER_URL: str = ""

    @field_validator("ALLOWED_EMAIL_DOMAINS", mode="before")
    @classmethod
    def parse_domains(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [d.strip().lower() for d in v.split(",") if d.strip()]
        return [d.lower() for d in v]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()

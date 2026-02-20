"""
User endpoints:
  - GET  /user/me        — current user profile
  - PATCH /user/me       — update profile + preferences
  - GET  /user/me/usage  — token usage stats
  - GET  /user/me/quota  — quota limits + usage
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.rbac import CurrentUser
from app.database import get_db
from app.models.db import User, UserPreferences, UserQuota

router = APIRouter(prefix="/user", tags=["user"])


# ── Response schemas (camelCase to match frontend) ───────────────────────────

class UserResponse(BaseModel):
    id: str
    email: str
    displayName: str | None
    avatarUrl: str | None
    role: str
    mfaEnabled: bool
    lastLoginAt: str | None
    createdAt: str

    @classmethod
    def from_db(cls, u: User) -> "UserResponse":
        return cls(
            id=str(u.id),
            email=u.email,
            displayName=u.display_name,
            avatarUrl=u.avatar_url,
            role=u.role,
            mfaEnabled=u.mfa_enabled,
            lastLoginAt=u.last_login_at.isoformat() if u.last_login_at else None,
            createdAt=u.created_at.isoformat(),
        )


class QuotaResponse(BaseModel):
    dailyTokenLimit: int
    monthlyTokenLimit: int
    contextWindowLimit: int
    dailyTokensUsed: int
    monthlyTokensUsed: int
    dailyResetAt: str
    monthlyResetAt: str

    @classmethod
    def from_db(cls, q: UserQuota) -> "QuotaResponse":
        return cls(
            dailyTokenLimit=q.daily_token_limit,
            monthlyTokenLimit=q.monthly_token_limit,
            contextWindowLimit=q.context_window_limit,
            dailyTokensUsed=q.daily_tokens_used,
            monthlyTokensUsed=q.monthly_tokens_used,
            dailyResetAt=q.daily_reset_at.isoformat(),
            monthlyResetAt=q.monthly_reset_at.isoformat(),
        )

    @classmethod
    def default(cls) -> "QuotaResponse":
        now = datetime.now(UTC)
        return cls(
            dailyTokenLimit=100000,
            monthlyTokenLimit=2000000,
            contextWindowLimit=128000,
            dailyTokensUsed=0,
            monthlyTokensUsed=0,
            dailyResetAt=now.isoformat(),
            monthlyResetAt=now.isoformat(),
        )


class UpdateMeRequest(BaseModel):
    displayName: str | None = None
    avatarUrl: str | None = None
    # preferences
    preferredProvider: str | None = None
    preferredModel: str | None = None
    theme: str | None = None
    accentColor: str | None = None
    fontSize: int | None = None
    reducedMotion: bool | None = None
    compactMode: bool | None = None
    sidebarWidth: int | None = None


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.from_db(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UpdateMeRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserResponse:
    # Update user fields
    if body.displayName is not None:
        current_user.display_name = body.displayName
    if body.avatarUrl is not None:
        current_user.avatar_url = body.avatarUrl

    # Update preferences
    pref_fields = {
        "preferredProvider": "preferred_provider",
        "preferredModel": "preferred_model",
        "theme": "theme",
        "accentColor": "accent_color",
        "fontSize": "font_size",
        "reducedMotion": "reduced_motion",
        "compactMode": "compact_mode",
        "sidebarWidth": "sidebar_width",
    }
    pref_updates = {
        db_field: getattr(body, api_field)
        for api_field, db_field in pref_fields.items()
        if getattr(body, api_field) is not None
    }

    if pref_updates:
        result = await db.execute(
            select(UserPreferences).where(UserPreferences.user_id == current_user.id)
        )
        prefs = result.scalar_one_or_none()
        if prefs:
            for k, v in pref_updates.items():
                setattr(prefs, k, v)
            prefs.updated_at = datetime.now(UTC)

    current_user.updated_at = datetime.now(UTC)
    await db.flush()
    return UserResponse.from_db(current_user)


@router.get("/me/usage", response_model=QuotaResponse)
async def get_usage(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> QuotaResponse:
    result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == current_user.id)
    )
    quota = result.scalar_one_or_none()
    if quota is None:
        return QuotaResponse.default()
    return QuotaResponse.from_db(quota)


@router.get("/me/quota", response_model=QuotaResponse)
async def get_quota(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> QuotaResponse:
    result = await db.execute(
        select(UserQuota).where(UserQuota.user_id == current_user.id)
    )
    quota = result.scalar_one_or_none()
    if quota is None:
        return QuotaResponse.default()
    return QuotaResponse.from_db(quota)

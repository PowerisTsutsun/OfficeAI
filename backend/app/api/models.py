"""
AI Models endpoint:
  - GET /models — list all enabled providers with their models
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Annotated

from app.core.rbac import CurrentUser
from app.database import get_db
from app.models.db import AIModel, AIProvider

router = APIRouter(prefix="/models", tags=["models"])


# ── Response schemas (camelCase to match frontend) ───────────────────────────

class AIModelResponse(BaseModel):
    id: str
    providerId: str
    modelId: str
    displayName: str
    contextWindow: int
    maxOutputTokens: int | None
    supportsVision: bool
    supportsTools: bool
    isEnabled: bool
    isBeta: bool
    sortOrder: int


class AIProviderResponse(BaseModel):
    id: str
    name: str
    displayName: str
    isEnabled: bool
    models: list[AIModelResponse]


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[AIProviderResponse])
async def list_models(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AIProviderResponse]:
    result = await db.execute(
        select(AIProvider)
        .where(AIProvider.is_enabled.is_(True))
        .options(selectinload(AIProvider.models))
        .order_by(AIProvider.name)
    )
    providers = result.scalars().all()

    return [
        AIProviderResponse(
            id=str(p.id),
            name=p.name,
            displayName=p.display_name,
            isEnabled=p.is_enabled,
            models=[
                AIModelResponse(
                    id=str(m.id),
                    providerId=str(m.provider_id),
                    modelId=m.model_id,
                    displayName=m.display_name,
                    contextWindow=m.context_window,
                    maxOutputTokens=m.max_output_tokens,
                    supportsVision=m.supports_vision,
                    supportsTools=m.supports_tools,
                    isEnabled=m.is_enabled,
                    isBeta=m.is_beta,
                    sortOrder=m.sort_order,
                )
                for m in sorted(p.models, key=lambda m: m.sort_order)
                if m.is_enabled
            ],
        )
        for p in providers
    ]

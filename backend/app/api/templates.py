"""
Prompt Template endpoints:
  - GET    /templates      — list user's + public templates
  - POST   /templates      — create a template
  - PATCH  /templates/:id  — update a template
  - DELETE /templates/:id  — delete a template
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import CurrentUser
from app.database import get_db
from app.models.db import PromptTemplate

router = APIRouter(prefix="/templates", tags=["templates"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class TemplateResponse(BaseModel):
    id: str
    userId: str | None
    title: str
    description: str | None
    content: str
    tags: list[str]
    isCompanyTemplate: bool
    isPublic: bool
    useCount: int
    createdAt: str
    updatedAt: str

    @classmethod
    def from_db(cls, t: PromptTemplate) -> "TemplateResponse":
        return cls(
            id=str(t.id),
            userId=str(t.user_id) if t.user_id else None,
            title=t.title,
            description=t.description,
            content=t.content,
            tags=t.tags or [],
            isCompanyTemplate=t.is_company_template,
            isPublic=t.is_public,
            useCount=t.use_count,
            createdAt=t.created_at.isoformat(),
            updatedAt=t.updated_at.isoformat(),
        )


class CreateTemplateRequest(BaseModel):
    title: str
    description: str | None = None
    content: str
    tags: list[str] = []
    isPublic: bool = False


class UpdateTemplateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    isPublic: bool | None = None


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[TemplateResponse])
async def list_templates(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TemplateResponse]:
    result = await db.execute(
        select(PromptTemplate)
        .where(
            or_(
                PromptTemplate.user_id == current_user.id,
                PromptTemplate.is_public.is_(True),
                PromptTemplate.is_company_template.is_(True),
            )
        )
        .order_by(PromptTemplate.updated_at.desc())
    )
    templates = result.scalars().all()
    return [TemplateResponse.from_db(t) for t in templates]


@router.post("", response_model=TemplateResponse, status_code=201)
async def create_template(
    body: CreateTemplateRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TemplateResponse:
    template = PromptTemplate(
        user_id=current_user.id,
        title=body.title,
        description=body.description,
        content=body.content,
        tags=body.tags,
        is_public=body.isPublic,
        created_by=current_user.id,
    )
    db.add(template)
    await db.flush()
    return TemplateResponse.from_db(template)


@router.patch("/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: uuid.UUID,
    body: UpdateTemplateRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TemplateResponse:
    result = await db.execute(
        select(PromptTemplate).where(PromptTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()

    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    # Only owner or admin can edit
    if template.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not authorized to edit this template")

    if body.title is not None:
        template.title = body.title
    if body.description is not None:
        template.description = body.description
    if body.content is not None:
        template.content = body.content
    if body.tags is not None:
        template.tags = body.tags
    if body.isPublic is not None:
        template.is_public = body.isPublic

    template.updated_at = datetime.now(UTC)
    await db.flush()
    return TemplateResponse.from_db(template)


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(
        select(PromptTemplate).where(PromptTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()

    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    if template.user_id != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not authorized to delete this template")

    await db.delete(template)
    await db.flush()

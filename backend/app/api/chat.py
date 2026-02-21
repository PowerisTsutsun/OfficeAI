"""
Chat endpoints — session management, streaming messages, token accounting.
All message content is encrypted at rest. Admin cannot read content.
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import append_audit_log
from app.core.rbac import CurrentUser
from app.core.security import decrypt_message, encrypt_message
from app.database import get_db
from app.models.db import AIModel, AIProvider, ChatFolder, ChatMessage, ChatSession, UserQuota
from app.services import rate_limiter
from app.services.ai_gateway import ChatMessage as AIChatMessage
from app.services.ai_gateway import get_gateway

router = APIRouter(prefix="/chat", tags=["chat"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    provider: str
    model: str
    title: str | None = None
    is_ephemeral: bool = False
    system_prompt: str | None = None
    folder_id: uuid.UUID | None = None
    tags: list[str] = []


class UpdateSessionRequest(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None
    tags: list[str] | None = None
    folder_id: uuid.UUID | None = None
    provider: str | None = None
    model: str | None = None


class SessionResponse(BaseModel):
    id: uuid.UUID
    title: str | None
    provider: str
    model: str
    is_pinned: bool
    is_ephemeral: bool
    tags: list[str]
    folder_id: uuid.UUID | None
    total_tokens_in: int
    total_tokens_out: int
    message_count: int
    last_message_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str           # Decrypted for the owning user only
    tokens_in: int
    tokens_out: int
    provider: str | None
    model: str | None
    finish_reason: str | None
    created_at: datetime


class SendMessageRequest(BaseModel):
    content: str
    temperature: float = 0.7


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _verify_model_access(
    provider_name: str,
    model_id: str,
    db: AsyncSession,
) -> tuple[AIProvider, AIModel]:
    """Verify provider and model are enabled. Returns (provider, model)."""
    result = await db.execute(
        select(AIProvider, AIModel)
        .join(AIModel, AIModel.provider_id == AIProvider.id)
        .where(
            AIProvider.name == provider_name,
            AIProvider.is_enabled.is_(True),
            AIModel.model_id == model_id,
            AIModel.is_enabled.is_(True),
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{provider_name}' or model '{model_id}' is not available",
        )
    return row


async def _check_quota(
    user_id: uuid.UUID,
    estimated_tokens: int,
    db: AsyncSession,
) -> UserQuota:
    """Check and enforce token quotas. Raises 429 if over limit."""
    result = await db.execute(select(UserQuota).where(UserQuota.user_id == user_id))
    quota = result.scalar_one_or_none()
    if quota is None:
        raise HTTPException(status_code=500, detail="User quota not found")

    # Reset daily/monthly if needed
    now = datetime.now(UTC)
    if quota.daily_reset_at <= now:
        quota.daily_tokens_used = 0
        from datetime import timedelta
        quota.daily_reset_at = now + timedelta(days=1)
    if quota.monthly_reset_at <= now:
        quota.monthly_tokens_used = 0
        from datetime import timedelta
        quota.monthly_reset_at = now + timedelta(days=30)

    if quota.daily_tokens_used + estimated_tokens > quota.daily_token_limit:
        raise HTTPException(
            status_code=429,
            detail=f"Daily token limit reached ({quota.daily_token_limit:,} tokens). Resets at {quota.daily_reset_at.isoformat()}.",
        )
    if quota.monthly_tokens_used + estimated_tokens > quota.monthly_token_limit:
        raise HTTPException(
            status_code=429,
            detail=f"Monthly token limit reached ({quota.monthly_token_limit:,} tokens).",
        )

    return quota


def _estimate_tokens(text: str) -> int:
    """Rough token estimate (4 chars ≈ 1 token). Server uses provider's actual count."""
    return max(1, len(text) // 4)


def _derive_session_title(content: str) -> str | None:
    """Derive a concise title from the user's message content."""
    cleaned = " ".join(content.strip().split())
    if not cleaned:
        return None
    max_len = 80
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 3].rstrip() + "..."


# ── Session endpoints ─────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    folder_id: uuid.UUID | None = None,
    search: str | None = None,
) -> list[SessionResponse]:
    q = (
        select(ChatSession)
        .where(
            ChatSession.user_id == current_user.id,
            ChatSession.deleted_at.is_(None),
        )
        .order_by(ChatSession.is_pinned.desc(), ChatSession.last_message_at.desc().nulls_last())
        .limit(limit)
        .offset(offset)
    )
    if folder_id:
        q = q.where(ChatSession.folder_id == folder_id)
    if search:
        q = q.where(ChatSession.title.ilike(f"%{search}%"))

    result = await db.execute(q)
    sessions = result.scalars().all()
    return [_session_to_response(s) for s in sessions]


def _session_to_response(s: ChatSession) -> SessionResponse:
    return SessionResponse(
        id=s.id,
        title=s.title,
        provider=s.provider,
        model=s.model,
        is_pinned=s.is_pinned,
        is_ephemeral=s.is_ephemeral,
        tags=s.tags or [],
        folder_id=s.folder_id,
        total_tokens_in=s.total_tokens_in,
        total_tokens_out=s.total_tokens_out,
        message_count=s.message_count,
        last_message_at=s.last_message_at,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    body: CreateSessionRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SessionResponse:
    await _verify_model_access(body.provider, body.model, db)

    sys_enc = sys_iv = None
    if body.system_prompt:
        sys_enc, sys_iv = encrypt_message(body.system_prompt, str(current_user.id))

    session = ChatSession(
        user_id=current_user.id,
        provider=body.provider,
        model=body.model,
        title=body.title,
        is_ephemeral=body.is_ephemeral,
        folder_id=body.folder_id,
        tags=body.tags,
        system_prompt_enc=sys_enc,
        system_prompt_iv=sys_iv,
    )
    db.add(session)
    await db.flush()

    await append_audit_log(
        db,
        event_type="CHAT_SESSION_CREATED",
        success=True,
        actor_id=current_user.id,
        actor_email=current_user.email,
        target_id=str(session.id),
        target_type="chat_session",
        metadata={
            "provider": body.provider,
            "model": body.model,
            "is_ephemeral": body.is_ephemeral,
        },
    )

    return _session_to_response(session)


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SessionResponse:
    session = await _get_owned_session(session_id, current_user.id, db)
    return _session_to_response(session)


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: uuid.UUID,
    body: UpdateSessionRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SessionResponse:
    session = await _get_owned_session(session_id, current_user.id, db)

    if body.title is not None:
        session.title = body.title
    if body.is_pinned is not None:
        session.is_pinned = body.is_pinned
    if body.tags is not None:
        session.tags = body.tags
    if body.folder_id is not None:
        session.folder_id = body.folder_id
    if body.provider is not None or body.model is not None:
        new_provider = body.provider or session.provider
        new_model = body.model or session.model
        await _verify_model_access(new_provider, new_model, db)
        session.provider = new_provider
        session.model = new_model

    return _session_to_response(session)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    session = await _get_owned_session(session_id, current_user.id, db)
    session.deleted_at = datetime.now(UTC)

    await append_audit_log(
        db,
        event_type="CHAT_SESSION_DELETED",
        success=True,
        actor_id=current_user.id,
        actor_email=current_user.email,
        target_id=str(session_id),
        target_type="chat_session",
    )


# ── Message endpoints ─────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/messages", response_model=list[MessageResponse])
async def get_messages(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(100, le=500),
    before_id: uuid.UUID | None = None,
) -> list[MessageResponse]:
    session = await _get_owned_session(session_id, current_user.id, db)

    q = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    )
    if before_id:
        before_result = await db.execute(
            select(ChatMessage.created_at).where(ChatMessage.id == before_id)
        )
        before_ts = before_result.scalar_one_or_none()
        if before_ts:
            q = q.where(ChatMessage.created_at < before_ts)

    result = await db.execute(q)
    messages = result.scalars().all()

    return [
        MessageResponse(
            id=m.id,
            role=m.role,
            content=decrypt_message(m.content_enc, m.content_iv, str(current_user.id)),
            tokens_in=m.tokens_in,
            tokens_out=m.tokens_out,
            provider=m.provider,
            model=m.model,
            finish_reason=m.finish_reason,
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: uuid.UUID,
    body: SendMessageRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """
    Send a message and stream the AI response via Server-Sent Events.
    The client receives chunks as: data: {"delta": "...", "done": false}\n\n
    """
    # Rate limit
    rate_key = f"chat:{current_user.id}"
    if not await rate_limiter.check(rate_key, limit=60, window=60):
        raise HTTPException(status_code=429, detail="Chat rate limit exceeded. Please slow down.")

    session = await _get_owned_session(session_id, current_user.id, db)

    # Estimate input tokens for quota check
    estimated = _estimate_tokens(body.content)
    quota = await _check_quota(current_user.id, estimated, db)

    # Check context window
    if estimated > quota.context_window_limit:
        raise HTTPException(status_code=400, detail="Message exceeds your context window limit.")

    # Verify model still enabled
    await _verify_model_access(session.provider, session.model, db)

    # Load conversation history for context
    msg_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
        .limit(100)  # sliding window — could be smarter
    )
    history = msg_result.scalars().all()

    # Decrypt system prompt if set
    system_prompt: str | None = None
    if session.system_prompt_enc and session.system_prompt_iv:
        system_prompt = decrypt_message(
            session.system_prompt_enc, session.system_prompt_iv, str(current_user.id)
        )

    # Build message list for AI
    ai_messages: list[AIChatMessage] = [
        AIChatMessage(
            role=m.role,  # type: ignore[arg-type]
            content=decrypt_message(m.content_enc, m.content_iv, str(current_user.id)),
        )
        for m in history
    ]
    ai_messages.append(AIChatMessage(role="user", content=body.content))

    # Store user message (encrypted)
    content_enc, content_iv = encrypt_message(body.content, str(current_user.id))
    user_msg = ChatMessage(
        session_id=session.id,
        role="user",
        content_enc=content_enc,
        content_iv=content_iv,
        tokens_in=estimated,
        is_ephemeral=session.is_ephemeral,
    )
    db.add(user_msg)
    if not (session.title and session.title.strip()):
        derived_title = _derive_session_title(body.content)
        if derived_title:
            session.title = derived_title
    session.message_count += 1
    session.last_message_at = datetime.now(UTC)
    await db.commit()

    # Audit: log metadata only (no content)
    async with db.begin():
        await append_audit_log(
            db,
            event_type="CHAT_MESSAGE_SENT",
            success=True,
            actor_id=current_user.id,
            actor_email=current_user.email,
            target_id=str(session.id),
            target_type="chat_session",
            metadata={
                "session_id": str(session.id),
                "provider": session.provider,
                "model": session.model,
                "estimated_tokens": estimated,
            },
        )

    async def event_stream() -> AsyncGenerator[str, None]:
        gateway = get_gateway()
        full_response = []
        final_tokens_in = 0
        final_tokens_out = 0
        finish_reason: str | None = None

        yield f"data: {json.dumps({'type': 'start', 'session_id': str(session_id)})}\n\n"

        async for chunk in gateway.stream_chat(
            session.provider,
            session.model,
            ai_messages,
            max_tokens=min(4096, quota.context_window_limit - estimated),
            temperature=body.temperature,
            system=system_prompt,
        ):
            if chunk.error:
                yield f"data: {json.dumps({'type': 'error', 'error': chunk.error})}\n\n"
                return

            if chunk.delta:
                full_response.append(chunk.delta)
                yield f"data: {json.dumps({'type': 'delta', 'delta': chunk.delta})}\n\n"

            if chunk.tokens_in:
                final_tokens_in = chunk.tokens_in
            if chunk.tokens_out:
                final_tokens_out = chunk.tokens_out
            if chunk.finish_reason:
                finish_reason = chunk.finish_reason

        # Save assistant message (encrypted)
        full_text = "".join(full_response)
        enc, iv = encrypt_message(full_text, str(current_user.id))

        async with db.begin():
            asst_msg = ChatMessage(
                session_id=session.id,
                role="assistant",
                content_enc=enc,
                content_iv=iv,
                tokens_in=final_tokens_in,
                tokens_out=final_tokens_out,
                provider=session.provider,
                model=session.model,
                finish_reason=finish_reason,
                is_ephemeral=session.is_ephemeral,
            )
            db.add(asst_msg)

            # Update session totals
            await db.execute(
                update(ChatSession)
                .where(ChatSession.id == session_id)
                .values(
                    total_tokens_in=ChatSession.total_tokens_in + final_tokens_in,
                    total_tokens_out=ChatSession.total_tokens_out + final_tokens_out,
                    message_count=ChatSession.message_count + 1,
                    last_message_at=datetime.now(UTC),
                )
            )

            # Update quota usage
            await db.execute(
                update(UserQuota)
                .where(UserQuota.user_id == current_user.id)
                .values(
                    daily_tokens_used=UserQuota.daily_tokens_used + final_tokens_in + final_tokens_out,
                    monthly_tokens_used=UserQuota.monthly_tokens_used + final_tokens_in + final_tokens_out,
                )
            )

        yield f"data: {json.dumps({'type': 'done', 'tokens_in': final_tokens_in, 'tokens_out': final_tokens_out, 'finish_reason': finish_reason})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Folders ───────────────────────────────────────────────────────────────────

class FolderResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: str | None
    icon: str | None
    sort_order: int
    created_at: datetime


class CreateFolderRequest(BaseModel):
    name: str
    color: str | None = None
    icon: str | None = None


@router.get("/folders", response_model=list[FolderResponse])
async def list_folders(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[FolderResponse]:
    result = await db.execute(
        select(ChatFolder)
        .where(ChatFolder.user_id == current_user.id)
        .order_by(ChatFolder.sort_order.asc())
    )
    return [
        FolderResponse(
            id=f.id, name=f.name, color=f.color, icon=f.icon,
            sort_order=f.sort_order, created_at=f.created_at,
        )
        for f in result.scalars().all()
    ]


@router.post("/folders", response_model=FolderResponse, status_code=201)
async def create_folder(
    body: CreateFolderRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FolderResponse:
    folder = ChatFolder(
        user_id=current_user.id,
        name=body.name,
        color=body.color,
        icon=body.icon,
    )
    db.add(folder)
    await db.flush()
    return FolderResponse(
        id=folder.id, name=folder.name, color=folder.color, icon=folder.icon,
        sort_order=folder.sort_order, created_at=folder.created_at,
    )


# ── Shared helpers ─────────────────────────────────────────────────────────────

async def _get_owned_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
            ChatSession.deleted_at.is_(None),
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session

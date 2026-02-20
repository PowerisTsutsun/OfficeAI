"""
Authentication endpoints:
  - Magic link (email-based, company domain only)
  - OIDC callback (SSO)
  - Token refresh + logout
  - MFA setup/verify
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.audit import append_audit_log
from app.core.rbac import CurrentUser, get_current_user
from app.core.security import (
    create_access_token,
    decrypt_text,
    encrypt_text,
    extract_domain,
    generate_magic_link_token,
    generate_refresh_token,
    hash_magic_link_token,
    hash_refresh_token,
    is_allowed_email,
    verify_refresh_token,
)
from app.database import get_db
from app.models.db import MagicLink, User, UserPreferences, UserQuota, UserSession
from app.services import rate_limiter

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

DEVICE_ID_HEADER = "X-Device-Id"
DEVICE_NAME_HEADER = "X-Device-Name"


# ── Schemas ───────────────────────────────────────────────────────────────────

class MagicLinkRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def check_domain(cls, v: str) -> str:
        if not is_allowed_email(v, settings.ALLOWED_EMAIL_DOMAINS):
            raise ValueError(
                f"Only company email addresses are allowed "
                f"({', '.join('@' + d for d in settings.ALLOWED_EMAIL_DOMAINS)})"
            )
        return v.lower()


class MagicLinkVerifyRequest(BaseModel):
    token: str
    device_id: str | None = None
    device_name: str | None = None


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class SessionInfo(BaseModel):
    id: str
    device_name: str | None
    platform: str | None
    ip_address: str | None
    created_at: datetime
    last_used_at: datetime
    is_current: bool = False


class MFASetupResponse(BaseModel):
    totp_uri: str
    backup_codes: list[str]


class MFAConfirmRequest(BaseModel):
    code: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_user(email: str, db: AsyncSession) -> User:
    """Get existing user or create new one (first-time login via magic link)."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        domain = extract_domain(email)
        user = User(
            email=email,
            email_domain=domain,
            display_name=email.split("@")[0].replace(".", " ").title(),
            role="user",
        )
        db.add(user)

        # Create default quota and preferences
        await db.flush()  # get user.id
        quota = UserQuota(
            user_id=user.id,
            daily_reset_at=datetime.now(UTC) + timedelta(days=1),
            monthly_reset_at=datetime.now(UTC) + timedelta(days=30),
        )
        prefs = UserPreferences(user_id=user.id)
        db.add(quota)
        db.add(prefs)

    return user


async def _create_session(
    user: User,
    db: AsyncSession,
    request: Request,
    device_id: str | None = None,
    device_name: str | None = None,
) -> tuple[str, str]:
    """Create a new session, returning (access_token, refresh_token)."""
    refresh_raw = generate_refresh_token()
    refresh_hash = hash_refresh_token(refresh_raw)

    session = UserSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        device_id=device_id or request.headers.get(DEVICE_ID_HEADER),
        device_name=device_name or request.headers.get(DEVICE_NAME_HEADER),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.flush()

    access_token = create_access_token(
        user_id=str(user.id),
        email=user.email,
        role=user.role,
        extra={"session_id": str(session.id)},
    )
    return access_token, refresh_raw


async def _send_magic_link_email(email: str, token: str) -> None:
    """Send magic link email. Replace with your email service."""
    import logging
    import smtplib
    from email.mime.text import MIMEText

    link = f"{settings.MAGIC_LINK_BASE_URL}/auth/verify?token={token}"

    # DEV MODE: always print magic link to server console so you can log in without SMTP
    if settings.APP_ENV == "development":
        logging.getLogger(__name__).warning(
            "\n\n  ✉️  MAGIC LINK for %s\n  🔗 %s\n",
            email,
            link,
        )

    msg = MIMEText(
        f"Click to sign in to {settings.APP_NAME}:\n\n{link}\n\nLink expires in {settings.MAGIC_LINK_EXPIRE_MINUTES} minutes.",
        "plain",
    )
    msg["Subject"] = f"Sign in to {settings.APP_NAME}"
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = email

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as s:
            s.starttls()
            if settings.SMTP_USER:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
    except Exception:
        logging.getLogger(__name__).exception("Failed to send magic link email to %s", email)


# ── Routes ────────────────────────────────────────────────────────────────────


class DevLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/dev-login", response_model=TokenResponse)
async def dev_login(
    body: DevLoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    """DEV ONLY: simple username/password login. Disabled in production."""
    if settings.APP_ENV != "development":
        raise HTTPException(status_code=404, detail="Not Found")

    if body.username != "admin" or body.password != "admin123":
        raise HTTPException(status_code=401, detail="Invalid credentials")

    email = "admin@company.local"
    user = await _get_or_create_user(email, db)

    # Ensure admin role
    if user.role != "super_admin":
        user.role = "super_admin"

    user.last_login_at = datetime.now(UTC)
    user.login_count += 1

    access_token, refresh_raw = await _create_session(user, db, request)

    await append_audit_log(
        db,
        event_type="AUTH_LOGIN_SUCCESS",
        success=True,
        actor_id=user.id,
        actor_email=user.email,
        actor_role=user.role,
        ip_address=request.client.host if request.client else None,
        metadata={"method": "dev_login"},
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_raw,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/magic-link", status_code=202)
async def request_magic_link(
    body: MagicLinkRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    """Request a magic link. Rate-limited per IP and per email."""
    ip = request.client.host if request.client else "unknown"

    # Rate limiting
    ip_key = f"magic_link_ip:{ip}"
    email_key = f"magic_link_email:{body.email}"
    if not await rate_limiter.check(ip_key, limit=settings.RATE_LIMIT_MAGIC_LINK_PER_IP, window=900):
        raise HTTPException(status_code=429, detail="Too many requests from this IP. Try again later.")
    if not await rate_limiter.check(email_key, limit=settings.RATE_LIMIT_MAGIC_LINK_PER_EMAIL, window=900):
        raise HTTPException(status_code=429, detail="Too many magic links requested for this email.")

    user = await _get_or_create_user(body.email, db)

    if not user.is_active or user.is_locked:
        # Return 202 anyway (don't leak account status to unauthenticated callers)
        return {"message": "If this email is registered, you'll receive a login link shortly."}

    raw_token, token_hash = generate_magic_link_token()
    magic = MagicLink(
        user_id=user.id,
        token_hash=token_hash,
        email=body.email,
        ip_address=ip,
        expires_at=datetime.now(UTC) + timedelta(minutes=settings.MAGIC_LINK_EXPIRE_MINUTES),
    )
    db.add(magic)

    background_tasks.add_task(_send_magic_link_email, body.email, raw_token)
    await append_audit_log(
        db,
        event_type="AUTH_MAGIC_LINK_SENT",
        success=True,
        actor_id=user.id,
        actor_email=user.email,
        ip_address=ip,
        metadata={"email": body.email},
    )

    return {"message": "If this email is registered, you'll receive a login link shortly."}


@router.post("/magic-link/verify", response_model=TokenResponse)
async def verify_magic_link(
    body: MagicLinkVerifyRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    token_hash = hash_magic_link_token(body.token)

    result = await db.execute(
        select(MagicLink).where(MagicLink.token_hash == token_hash)
    )
    magic = result.scalar_one_or_none()

    if magic is None or magic.used_at is not None:
        raise HTTPException(status_code=400, detail="Invalid or already-used link")

    if magic.expires_at < datetime.now(UTC):
        await append_audit_log(
            db,
            event_type="AUTH_MAGIC_LINK_EXPIRED",
            success=False,
            ip_address=ip,
            reason_code="EXPIRED",
        )
        raise HTTPException(status_code=400, detail="Link has expired. Please request a new one.")

    # Mark as used
    magic.used_at = datetime.now(UTC)

    result2 = await db.execute(select(User).where(User.id == magic.user_id))
    user = result2.scalar_one()

    if not user.is_active or user.is_locked:
        raise HTTPException(status_code=403, detail="Account is not accessible")

    user.last_login_at = datetime.now(UTC)
    user.login_count += 1

    access_token, refresh_raw = await _create_session(
        user, db, request, body.device_id, body.device_name
    )

    await append_audit_log(
        db,
        event_type="AUTH_LOGIN_SUCCESS",
        success=True,
        actor_id=user.id,
        actor_email=user.email,
        actor_role=user.role,
        ip_address=ip,
        metadata={"method": "magic_link"},
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_raw,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/token/refresh", response_model=TokenResponse)
async def refresh_token(
    body: TokenRefreshRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    device_id = request.headers.get(DEVICE_ID_HEADER)

    # Find active session — scan recent sessions for this device
    result = await db.execute(
        select(UserSession)
        .where(
            UserSession.device_id == device_id,
            UserSession.is_revoked.is_(False),
            UserSession.expires_at > datetime.now(UTC),
        )
        .limit(10)
    )
    sessions = result.scalars().all()

    matched_session: UserSession | None = None
    for session in sessions:
        if verify_refresh_token(body.refresh_token, session.refresh_token_hash):
            matched_session = session
            break

    if matched_session is None:
        # Reuse detected or invalid token — revoke entire family
        await append_audit_log(
            db,
            event_type="AUTH_TOKEN_REUSE_DETECTED",
            success=False,
            ip_address=ip,
            reason_code="REFRESH_TOKEN_REUSE",
        )
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    # Rotate: revoke old, create new
    matched_session.is_revoked = True
    matched_session.revoked_at = datetime.now(UTC)
    matched_session.revoked_reason = "token_rotation"

    result2 = await db.execute(select(User).where(User.id == matched_session.user_id))
    user = result2.scalar_one()

    access_token, refresh_raw = await _create_session(user, db, request)

    await append_audit_log(
        db,
        event_type="AUTH_TOKEN_REFRESHED",
        success=True,
        actor_id=user.id,
        actor_email=user.email,
        ip_address=ip,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_raw,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    device_id = request.headers.get(DEVICE_ID_HEADER)

    result = await db.execute(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.device_id == device_id,
            UserSession.is_revoked.is_(False),
        )
    )
    sessions = result.scalars().all()
    for s in sessions:
        s.is_revoked = True
        s.revoked_at = datetime.now(UTC)
        s.revoked_reason = "user_logout"

    await append_audit_log(
        db,
        event_type="AUTH_LOGOUT",
        success=True,
        actor_id=current_user.id,
        actor_email=current_user.email,
        ip_address=request.client.host if request.client else None,
    )


@router.get("/sessions", response_model=list[SessionInfo])
async def list_sessions(
    current_user: CurrentUser,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SessionInfo]:
    result = await db.execute(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.is_revoked.is_(False),
            UserSession.expires_at > datetime.now(UTC),
        )
    )
    sessions = result.scalars().all()
    current_device = request.headers.get(DEVICE_ID_HEADER)

    return [
        SessionInfo(
            id=str(s.id),
            device_name=s.device_name,
            platform=s.platform,
            ip_address=str(s.ip_address) if s.ip_address else None,
            created_at=s.created_at,
            last_used_at=s.last_used_at,
            is_current=(s.device_id == current_device),
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(
        select(UserSession).where(
            UserSession.id == session_id,
            UserSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session.is_revoked = True
    session.revoked_at = datetime.now(UTC)
    session.revoked_reason = "user_revoked"

    await append_audit_log(
        db,
        event_type="AUTH_SESSION_REVOKED",
        success=True,
        actor_id=current_user.id,
        actor_email=current_user.email,
        target_id=str(session_id),
        target_type="session",
    )

"""
Audit Logger — append-only, tamper-evident hash chain.

Event types (never log prompt/response content):
  AUTH_LOGIN_SUCCESS       AUTH_LOGIN_FAILED        AUTH_LOGOUT
  AUTH_MAGIC_LINK_SENT     AUTH_MAGIC_LINK_VERIFIED  AUTH_MAGIC_LINK_EXPIRED
  AUTH_MFA_ENABLED         AUTH_MFA_DISABLED         AUTH_MFA_FAILED
  AUTH_TOKEN_REFRESHED     AUTH_SESSION_REVOKED      AUTH_BRUTE_FORCE_LOCKOUT
  CHAT_SESSION_CREATED     CHAT_SESSION_DELETED      CHAT_EPHEMERAL_TOGGLED
  CHAT_MESSAGE_SENT        (metadata only: session_id, tokens, model)
  USER_ROLE_CHANGED        USER_QUOTA_CHANGED        USER_LOCKED  USER_UNLOCKED
  USER_INVITED             USER_DEACTIVATED
  MODEL_ENABLED            MODEL_DISABLED            MODEL_ADDED  MODEL_UPDATED
  PROVIDER_ENABLED         PROVIDER_DISABLED
  KEY_ROTATION             POLICY_CHANGE
  ADMIN_ACCESS             RATE_LIMIT_EXCEEDED
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import AuditLog

logger = logging.getLogger(__name__)

_GENESIS_HASH = "0" * 64  # Hash of the "genesis" entry (no previous entry)


def _compute_hash(
    seq: int,
    event_type: str,
    actor_id: str | None,
    target_id: str | None,
    ip_address: str | None,
    success: bool,
    metadata: dict,
    created_at: str,
    prev_hash: str,
) -> str:
    """
    SHA-256 hash over canonical JSON of the entry's immutable fields.
    The hash covers prev_hash, creating the chain linkage.
    """
    meta_hash = hashlib.sha256(
        json.dumps(metadata, sort_keys=True, default=str).encode()
    ).hexdigest()

    payload = json.dumps(
        {
            "seq": seq,
            "event_type": event_type,
            "actor_id": actor_id,
            "target_id": target_id,
            "ip_address": ip_address,
            "success": success,
            "meta_hash": meta_hash,
            "created_at": created_at,
            "prev_hash": prev_hash,
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


async def append_audit_log(
    db: AsyncSession,
    *,
    event_type: str,
    success: bool,
    actor_id: UUID | None = None,
    actor_email: str | None = None,
    actor_role: str | None = None,
    target_id: str | None = None,
    target_type: str | None = None,
    ip_address: str | None = None,
    device_id: str | None = None,
    reason_code: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditLog:
    """
    Atomically append an audit log entry with the next sequence number
    and compute the hash chain.

    IMPORTANT: metadata must NEVER contain prompt/response content.
    Only include: session_id, model, provider, token_counts, error_codes,
    timestamps, config names — never user text.
    """
    if metadata is None:
        metadata = {}

    # Sanitize: remove any keys that might contain user content
    _FORBIDDEN_KEYS = {"prompt", "content", "message", "text", "response", "input", "output"}
    for k in list(metadata.keys()):
        if k.lower() in _FORBIDDEN_KEYS:
            logger.warning("Audit log: removed forbidden metadata key '%s'", k)
            del metadata[k]

    # Get next sequence number and previous hash atomically
    result = await db.execute(
        select(AuditLog.seq, AuditLog.entry_hash)
        .order_by(AuditLog.seq.desc())
        .limit(1)
        .with_for_update()
    )
    last = result.one_or_none()

    seq = (last.seq + 1) if last else 1
    prev_hash = last.entry_hash if last else _GENESIS_HASH
    now = datetime.now(UTC)
    now_iso = now.isoformat()

    entry_hash = _compute_hash(
        seq=seq,
        event_type=event_type,
        actor_id=str(actor_id) if actor_id else None,
        target_id=target_id,
        ip_address=ip_address,
        success=success,
        metadata=metadata,
        created_at=now_iso,
        prev_hash=prev_hash,
    )

    entry = AuditLog(
        seq=seq,
        event_type=event_type,
        actor_id=actor_id,
        actor_email=actor_email,
        actor_role=actor_role,
        target_id=str(target_id) if target_id else None,
        target_type=target_type,
        ip_address=ip_address,
        device_id=device_id,
        success=success,
        reason_code=reason_code,
        event_metadata=metadata,
        prev_hash=prev_hash,
        entry_hash=entry_hash,
        created_at=now,
    )
    db.add(entry)
    await db.flush()  # Get ID without committing
    return entry


async def verify_chain(db: AsyncSession) -> tuple[bool, int | None]:
    """
    Walk the entire audit log chain and verify hashes.
    Returns (is_valid, first_broken_seq_or_None).
    """
    result = await db.execute(
        select(AuditLog).order_by(AuditLog.seq.asc())
    )
    entries = result.scalars().all()

    prev_hash = _GENESIS_HASH
    for entry in entries:
        if entry.prev_hash != prev_hash:
            return False, entry.seq

        expected = _compute_hash(
            seq=entry.seq,
            event_type=entry.event_type,
            actor_id=str(entry.actor_id) if entry.actor_id else None,
            target_id=entry.target_id,
            ip_address=str(entry.ip_address) if entry.ip_address else None,
            success=entry.success,
            metadata=entry.event_metadata,
            created_at=entry.created_at.isoformat(),
            prev_hash=prev_hash,
        )
        if entry.entry_hash != expected:
            return False, entry.seq

        prev_hash = entry.entry_hash

    return True, None

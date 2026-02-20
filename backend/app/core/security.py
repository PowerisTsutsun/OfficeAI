"""
Core security utilities:
  - JWT generation & verification (RS256)
  - Message encryption/decryption (AES-256-GCM)
  - Refresh token & magic link token handling
  - Domain allowlist check
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
import bcrypt
import jwt as pyjwt

from app.config import get_settings

settings = get_settings()

# ── JWT ──────────────────────────────────────────────────────────────────────

_ALGORITHM = "RS256"


def create_access_token(
    user_id: str,
    email: str,
    role: str,
    extra: dict[str, Any] | None = None,
) -> str:
    """Create a short-lived RS256 access token (15 min default)."""
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti": str(uuid.uuid4()),
        **(extra or {}),
    }
    return pyjwt.encode(payload, settings.JWT_PRIVATE_KEY, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Verify and decode access token.
    Raises jwt.ExpiredSignatureError / jwt.InvalidTokenError on failure.
    """
    return pyjwt.decode(
        token,
        settings.JWT_PUBLIC_KEY,
        algorithms=[_ALGORITHM],
        options={"require": ["sub", "email", "role", "exp", "iat", "jti"]},
    )


# ── Refresh tokens ────────────────────────────────────────────────────────────

def generate_refresh_token() -> str:
    """Generate a cryptographically secure refresh token (384-bit)."""
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """Bcrypt hash for DB storage."""
    return bcrypt.hashpw(token.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_refresh_token(token: str, token_hash: str) -> bool:
    return bcrypt.checkpw(token.encode(), token_hash.encode())


# ── Magic links ──────────────────────────────────────────────────────────────

def generate_magic_link_token() -> tuple[str, str]:
    """
    Returns (raw_token, sha256_hex_hash).
    Store only the hash. Send raw token to user via email.
    """
    raw = secrets.token_urlsafe(32)   # 256-bit
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return raw, digest


def hash_magic_link_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Message encryption (AES-256-GCM) ─────────────────────────────────────────

def _derive_user_key(user_id: str) -> bytes:
    """Derive a per-user 256-bit encryption key from the master key."""
    master = base64.b64decode(settings.MASTER_ENCRYPTION_KEY)
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=f"user-msg-key:{user_id}".encode(),
    )
    return hkdf.derive(master)


def encrypt_message(plaintext: str, user_id: str) -> tuple[str, str]:
    """
    Encrypt a chat message for a specific user.
    Returns (ciphertext_b64, iv_b64) — both base64 encoded.
    """
    key = _derive_user_key(user_id)
    iv = os.urandom(12)  # 96-bit random IV
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    return (
        base64.b64encode(ciphertext).decode(),
        base64.b64encode(iv).decode(),
    )


def decrypt_message(ciphertext_b64: str, iv_b64: str, user_id: str) -> str:
    """Decrypt a chat message. Raises ValueError on auth tag failure."""
    key = _derive_user_key(user_id)
    iv = base64.b64decode(iv_b64)
    ciphertext = base64.b64decode(ciphertext_b64)
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(iv, ciphertext, None)
        return plaintext.decode("utf-8")
    except Exception as e:
        raise ValueError("Message decryption failed — data may be corrupted") from e


def encrypt_text(plaintext: str, info: str = "app-data") -> tuple[str, str]:
    """Generic encryption (for MFA secrets etc.) using app-level key."""
    master = base64.b64decode(settings.MASTER_ENCRYPTION_KEY)
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=info.encode(),
    )
    key = hkdf.derive(master)
    iv = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    return base64.b64encode(ciphertext).decode(), base64.b64encode(iv).decode()


def decrypt_text(ciphertext_b64: str, iv_b64: str, info: str = "app-data") -> str:
    master = base64.b64decode(settings.MASTER_ENCRYPTION_KEY)
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=info.encode(),
    )
    key = hkdf.derive(master)
    iv = base64.b64decode(iv_b64)
    ciphertext = base64.b64decode(ciphertext_b64)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(iv, ciphertext, None).decode("utf-8")


# ── Domain allowlist ──────────────────────────────────────────────────────────

def is_allowed_email(email: str, allowed_domains: list[str]) -> bool:
    """Check if email belongs to one of the allowed domains. '*' allows all."""
    if not allowed_domains or "*" in allowed_domains:
        return True
    try:
        _, domain = email.lower().split("@", 1)
        return domain in {d.lower() for d in allowed_domains}
    except ValueError:
        return False


def extract_domain(email: str) -> str:
    return email.lower().split("@", 1)[1]

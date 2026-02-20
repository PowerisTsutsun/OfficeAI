"""
Role-Based Access Control — FastAPI dependencies.
All enforcement is SERVER-SIDE. Role is read from DB, not from JWT claims.
"""
from __future__ import annotations

from typing import Annotated

import jwt as pyjwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.database import get_db
from app.models.db import User

bearer_scheme = HTTPBearer(auto_error=False)


class AuthError(HTTPException):
    def __init__(self, detail: str, code: int = status.HTTP_401_UNAUTHORIZED):
        super().__init__(
            status_code=code,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


async def _get_user_from_token(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> User:
    if credentials is None:
        raise AuthError("Missing authentication token")

    try:
        payload = decode_access_token(credentials.credentials)
    except pyjwt.ExpiredSignatureError:
        raise AuthError("Token has expired")
    except pyjwt.InvalidTokenError:
        raise AuthError("Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("Invalid token payload")

    # Always re-fetch from DB — never trust role from JWT
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise AuthError("User not found")
    if not user.is_active:
        raise AuthError("Account is deactivated", status.HTTP_403_FORBIDDEN)
    if user.is_locked:
        raise AuthError(
            f"Account is locked: {user.locked_reason or 'contact support'}",
            status.HTTP_403_FORBIDDEN,
        )

    return user


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Dependency: returns the authenticated user. Any role accepted."""
    return await _get_user_from_token(credentials, db)


async def require_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Dependency: requires admin or super_admin role."""
    if user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


async def require_super_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Dependency: requires super_admin role."""
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return user


# Type aliases for use in route signatures
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
SuperAdminUser = Annotated[User, Depends(require_super_admin)]

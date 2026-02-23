from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Literal


PrivacyMode = Literal["true_private", "local", "masked_private"]


@dataclass
class RedactionItem:
    placeholder: str
    value: str
    value_type: str


@dataclass
class RedactionResult:
    redacted_text: str
    status: Literal["clean", "redacted"]
    items: list[RedactionItem]
    content_hash: str


_SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("api_key", re.compile(r"\b(?:sk|rk|pk)_[A-Za-z0-9]{16,}\b")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("bearer_token", re.compile(r"\bBearer\s+[A-Za-z0-9\-\._~\+\/]+=*\b", re.IGNORECASE)),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("cc_number", re.compile(r"\b(?:\d[ -]*?){13,19}\b")),
    ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
]

_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_LONG_NUMBER_RE = re.compile(r"\b\d{6,20}\b")
_BUSINESS_HINT_RE = re.compile(r"(po|invoice|ticket|order)\s*#?\s*$", re.IGNORECASE)
_SECRET_HINT_RE = re.compile(r"(secret|token|password|api[_ -]?key|credential)\s*[:=]?\s*$", re.IGNORECASE)


def redact_text(text: str, mode: PrivacyMode) -> RedactionResult:
    normalized = text or ""
    content_hash = sha256(normalized.encode("utf-8")).hexdigest()

    if mode != "masked_private":
        return RedactionResult(
            redacted_text=normalized,
            status="clean",
            items=[],
            content_hash=content_hash,
        )

    items: list[RedactionItem] = []
    redacted = normalized
    counter = 1

    def replace_span(value: str, value_type: str) -> str:
        nonlocal counter
        placeholder = f"{{{{{value_type.upper()}_{counter}}}}}"
        counter += 1
        items.append(RedactionItem(placeholder=placeholder, value=value, value_type=value_type))
        return placeholder

    # Pattern-driven secret masking.
    for value_type, pattern in _SECRET_PATTERNS:
        redacted = pattern.sub(lambda m: replace_span(m.group(0), value_type), redacted)

    # Email is treated as PII.
    redacted = _EMAIL_RE.sub(lambda m: replace_span(m.group(0), "pii_email"), redacted)

    # Contextual numeric masking: keep business IDs, mask secret-like numbers.
    matches = list(_LONG_NUMBER_RE.finditer(redacted))
    for match in reversed(matches):
        start, end = match.span()
        value = redacted[start:end]
        left_context = redacted[max(0, start - 32):start]
        if _BUSINESS_HINT_RE.search(left_context):
            continue
        if _SECRET_HINT_RE.search(left_context):
            placeholder = replace_span(value, "secret_number")
            redacted = f"{redacted[:start]}{placeholder}{redacted[end:]}"

    status: Literal["clean", "redacted"] = "redacted" if items else "clean"
    return RedactionResult(
        redacted_text=redacted,
        status=status,
        items=items,
        content_hash=content_hash,
    )

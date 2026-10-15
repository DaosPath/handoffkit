"""Small text tools."""

from __future__ import annotations

import re
from collections import Counter

from handoffkit.tool import tool

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
}


@tool
def summarize_text(text: str, max_chars: int = 500) -> str:
    """Return a compact character-limited summary."""
    clean = " ".join(text.strip().split())
    if len(clean) <= max_chars:
        return clean
    if max_chars <= 3:
        return clean[:max_chars]
    return clean[: max_chars - 3].rstrip() + "..."


@tool
def extract_keywords(text: str) -> list[str]:
    """Extract simple frequency-based keywords."""
    words = [
        word.lower()
        for word in re.findall(r"[A-Za-z][A-Za-z0-9_+-]{2,}", text)
        if word.lower() not in STOPWORDS
    ]
    counts = Counter(words)
    return [word for word, _ in counts.most_common(10)]

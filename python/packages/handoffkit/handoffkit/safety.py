"""Basic safety checks for tool execution."""

from __future__ import annotations

import re


class UnsafeToolCallError(Exception):
    """Raised when a tool call is blocked by the safety policy."""


DANGEROUS_COMMAND_PATTERNS = (
    re.compile(r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b", re.IGNORECASE),
    re.compile(r"\bdel\s+/s\b", re.IGNORECASE),
    re.compile(r"\bformat\b", re.IGNORECASE),
    re.compile(r"\bshutdown\b", re.IGNORECASE),
    re.compile(r"\breboot\b", re.IGNORECASE),
    re.compile(r"\bmkfs(\.[a-z0-9]+)?\b", re.IGNORECASE),
    re.compile(r"\bdiskpart\b", re.IGNORECASE),
    re.compile(r"\bcurl\s+[^\n]*\|\s*(sh|bash)\b", re.IGNORECASE),
    re.compile(r"\bwget\s+[^\n]*\|\s*(sh|bash)\b", re.IGNORECASE),
)

# Mutating / high-impact tools require explicit approval by default (P0).
APPROVAL_REQUIRED_TOOLS = frozenset(
    {
        "run_command",
        "write_file",
        "extract_audio",
        "mux_audio",
    }
)


def is_dangerous_command(command: str) -> bool:
    """Return whether a shell command matches the blocked command policy."""
    normalized = " ".join(command.strip().split())
    return any(pattern.search(normalized) for pattern in DANGEROUS_COMMAND_PATTERNS)


def requires_approval(tool_name: str) -> bool:
    """Return whether a tool should be blocked when approval is required."""
    return tool_name in APPROVAL_REQUIRED_TOOLS

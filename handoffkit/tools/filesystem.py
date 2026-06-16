"""Filesystem tools."""

from __future__ import annotations

from pathlib import Path

from handoffkit.tool import tool


@tool
def read_file(path: str) -> str:
    """Read a UTF-8 text file."""
    return Path(path).read_text(encoding="utf-8")


@tool
def write_file(path: str, content: str) -> str:
    """Write content to a UTF-8 text file."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return str(target)


@tool
def list_files(path: str) -> list[str]:
    """List files and directories in a directory."""
    return sorted(str(item) for item in Path(path).iterdir())


@tool
def file_exists(path: str) -> bool:
    """Return whether a path exists."""
    return Path(path).exists()

"""Filesystem tools restricted to the tool sandbox workspace."""

from __future__ import annotations

from handoffkit.sandbox import SandboxError, get_sandbox
from handoffkit.tool import tool


def _path(path: str):
    try:
        return get_sandbox().resolve(path)
    except SandboxError as exc:
        raise FileNotFoundError(str(exc)) from exc


@tool
def read_file(path: str) -> str:
    """Read a UTF-8 text file inside the workspace."""
    return _path(path).read_text(encoding="utf-8")


@tool
def write_file(path: str, content: str) -> str:
    """Write content to a UTF-8 text file inside the workspace."""
    target = _path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return str(target)


@tool
def list_files(path: str) -> list[str]:
    """List files and directories in a workspace directory."""
    return sorted(str(item) for item in _path(path).iterdir())


@tool
def file_exists(path: str) -> bool:
    """Return whether a path exists inside the workspace."""
    try:
        return _path(path).exists()
    except (FileNotFoundError, SandboxError, OSError):
        return False

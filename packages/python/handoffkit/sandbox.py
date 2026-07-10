"""Mandatory tool sandbox: workspace FS limits and execution policy.

P0 (1.14): tools that touch the filesystem or process table must stay inside a
workspace root. Approvals default to on for mutating tools.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class SandboxError(Exception):
    """Raised when a tool call violates the sandbox policy."""


@dataclass
class ToolSandbox:
    """Execution policy for tools."""

    workspace: Path
    """Resolved absolute workspace root; all FS paths must stay under this."""

    require_approval: bool = True
    """When True, mutating tools need an explicit approval bypass."""

    sandbox_enabled: bool = True
    """When True (default / mandatory), enforce workspace path containment."""

    def resolve(self, path: str | Path) -> Path:
        """Resolve ``path`` and ensure it stays inside the workspace."""
        if not self.sandbox_enabled:
            return Path(path).expanduser().resolve()
        root = self.workspace.resolve()
        candidate = Path(path).expanduser()
        if not candidate.is_absolute():
            candidate = root / candidate
        resolved = candidate.resolve()
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise SandboxError(
                f"path {resolved} is outside workspace {root}"
            ) from exc
        return resolved

    def assert_cwd(self, cwd: str | Path | None) -> Path | None:
        """Validate optional cwd for process tools."""
        if cwd is None:
            return self.workspace.resolve()
        return self.resolve(cwd)


_POLICY: ToolSandbox | None = None


def default_workspace() -> Path:
    """Workspace root: HANDOFFKIT_WORKSPACE, else process cwd."""
    env = os.environ.get("HANDOFFKIT_WORKSPACE", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return Path.cwd().resolve()


def get_sandbox() -> ToolSandbox:
    """Return the process-wide tool sandbox (lazy default)."""
    global _POLICY
    if _POLICY is None:
        _POLICY = ToolSandbox(
            workspace=default_workspace(),
            require_approval=True,
            sandbox_enabled=True,
        )
    return _POLICY


def set_sandbox(
    workspace: str | Path | None = None,
    *,
    require_approval: bool | None = None,
    sandbox_enabled: bool | None = None,
) -> ToolSandbox:
    """Configure (or replace) the process-wide tool sandbox."""
    global _POLICY
    current = get_sandbox()
    _POLICY = ToolSandbox(
        workspace=Path(workspace).expanduser().resolve()
        if workspace is not None
        else current.workspace,
        require_approval=current.require_approval
        if require_approval is None
        else require_approval,
        sandbox_enabled=current.sandbox_enabled
        if sandbox_enabled is None
        else sandbox_enabled,
    )
    return _POLICY


def reset_sandbox() -> None:
    """Clear process policy (tests). Next get_sandbox() rebuilds defaults."""
    global _POLICY
    _POLICY = None

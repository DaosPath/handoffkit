"""Shared pytest fixtures and monorepo/sdist helpers."""

from __future__ import annotations

from pathlib import Path

import pytest

from handoffkit.sandbox import reset_sandbox, set_sandbox

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_ROOT.parents[1]
CONTRACTS_ROOT = REPO_ROOT / "packages" / "contracts"


def is_monorepo_checkout() -> bool:
    """True when full monorepo paths (contracts, .github) are available."""
    return (REPO_ROOT / ".github" / "workflows" / "ci.yml").is_file() and (
        CONTRACTS_ROOT / "fixtures"
    ).is_dir()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "monorepo: test needs full monorepo files not present in a bare sdist install",
    )


@pytest.fixture(autouse=True)
def _tool_sandbox_for_tests() -> None:
    """Pin tool sandbox to package root so FS tools cannot escape during tests."""
    # Use package root as workspace so relative paths like README.md and tests/ work.
    set_sandbox(PACKAGE_ROOT, require_approval=True, sandbox_enabled=True)
    yield
    reset_sandbox()


def skip_unless_monorepo() -> None:
    if not is_monorepo_checkout():
        pytest.skip("requires monorepo checkout (not available in bare sdist layout)")

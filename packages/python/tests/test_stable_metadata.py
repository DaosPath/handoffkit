"""Stable release metadata tests."""

from __future__ import annotations

from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 fallback.
    import tomli as tomllib

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_ROOT.parents[1]


def test_pyproject_is_186_stable() -> None:
    data = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    project = data["project"]
    classifiers = project["classifiers"]

    assert project["version"] == "1.8.6"
    assert "Development Status :: 5 - Production/Stable" in classifiers
    assert not any("Alpha" in item or "Beta" in item for item in classifiers)


def test_ci_python_matrix_includes_310_to_314() -> None:
    text = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    for version in ["3.10", "3.11", "3.12", "3.13", "3.14"]:
        assert version in text

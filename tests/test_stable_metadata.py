"""Stable release metadata tests."""

from __future__ import annotations

from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 fallback.
    import tomli as tomllib


def test_pyproject_is_150_stable() -> None:
    data = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
    project = data["project"]
    classifiers = project["classifiers"]

    assert project["version"] == "1.5.0"
    assert "Development Status :: 5 - Production/Stable" in classifiers
    assert not any("Alpha" in item or "Beta" in item for item in classifiers)


def test_ci_python_matrix_includes_310_to_314() -> None:
    text = Path(".github/workflows/ci.yml").read_text(encoding="utf-8")

    for version in ["3.10", "3.11", "3.12", "3.13", "3.14"]:
        assert version in text

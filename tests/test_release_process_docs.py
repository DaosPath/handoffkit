"""Release process and package trust documentation tests."""

from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def has_pypi_token(text: str) -> bool:
    return re.search(r"pypi-[A-Za-z0-9_-]{20,}", text) is not None


def test_publish_workflow_uses_trusted_publishing_without_tokens() -> None:
    text = read(".github/workflows/publish.yml")

    assert "id-token: write" in text
    assert "pypa/gh-action-pypi-publish@release/v1" in text
    assert "workflow_dispatch" in text
    assert "release:" in text
    assert "testpypi" in text
    assert "pypi" in text
    assert "TWINE_PASSWORD" not in text
    assert "TWINE_USERNAME" not in text
    assert "PYPI_TOKEN" not in text
    assert "TEST_PYPI_TOKEN" not in text
    assert not has_pypi_token(text)


def test_release_process_docs_cover_trusted_publishing() -> None:
    text = read("docs/RELEASE_PROCESS.md")

    assert "Trusted Publishing" in text
    assert "publish.yml" in text
    assert "testpypi" in text
    assert "pypi" in text
    assert "DaosPath" in text
    assert "handoffkit" in text
    assert "TWINE_PASSWORD" not in text
    assert not has_pypi_token(text)


def test_security_policy_exists_without_real_tokens() -> None:
    text = read("SECURITY.md")

    assert "1.x" in text
    assert "vulnerabil" in text.lower()
    assert "Trusted Publishing" in text
    assert not has_pypi_token(text)


def test_readme_documents_package_trust() -> None:
    text = read("README.md")

    assert "## Publishing" in text
    assert "Trusted Publishing" in text
    assert "docs/RELEASE_PROCESS.md" in text
    assert "package tokens" in text

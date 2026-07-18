"""Tests for provider matrix behavior and demo."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from handoffkit import ProviderToolAdapter, tool
from handoffkit.structured import OutputValidationError

ROOT = Path(__file__).resolve().parents[1]


@tool
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def test_provider_matrix_formats_have_one_tool_each() -> None:
    for provider_format in ["handoffkit", "openai", "anthropic"]:
        tools = ProviderToolAdapter(provider_format=provider_format).tools_to_provider_format([add])
        assert len(tools) == 1


def test_malformed_openai_missing_name_fails_clearly() -> None:
    adapter = ProviderToolAdapter(provider_format="openai")

    with pytest.raises(OutputValidationError, match="name is required"):
        adapter.parse_tool_calls({"tool_calls": [{"function": {"arguments": "{}"}}]})


def test_malformed_handoffkit_missing_name_fails_clearly() -> None:
    adapter = ProviderToolAdapter()

    with pytest.raises(OutputValidationError, match="name is required"):
        adapter.parse_tool_calls({"tool_calls": [{"arguments": {}}]})


def test_malformed_anthropic_missing_name_fails_clearly() -> None:
    adapter = ProviderToolAdapter(provider_format="anthropic")

    with pytest.raises(OutputValidationError, match="name is required"):
        adapter.parse_tool_calls({"content": [{"type": "tool_use", "input": {}}]})


def test_malformed_tool_calls_item_fails_clearly() -> None:
    adapter = ProviderToolAdapter()

    with pytest.raises(OutputValidationError, match="items must be objects"):
        adapter.parse_tool_calls({"tool_calls": ["bad"]})


def test_provider_matrix_demo_runs() -> None:
    completed = subprocess.run(
        [sys.executable, str(ROOT / "examples" / "demos" / "provider_matrix_demo.py")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "Provider matrix success: True" in completed.stdout
    report = json.loads((ROOT / "reports" / "provider_matrix_demo.json").read_text())
    assert report["formats"] == ["handoffkit", "openai", "anthropic"]

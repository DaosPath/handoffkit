"""Cross-runtime contract tests for Python and JavaScript HandoffKit."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from handoffkit import HandoffState, RunTrace

CONTRACTS_ROOT = Path(__file__).resolve().parents[2] / "contracts"


def load_fixture(name: str) -> dict[str, object]:
    """Load a shared contract fixture or skip outside the monorepo."""
    path = CONTRACTS_ROOT / "fixtures" / name
    if not path.exists():
        pytest.skip("shared contracts folder is not present in this source layout")
    return json.loads(path.read_text(encoding="utf-8"))


def test_handoff_state_reads_and_writes_shared_contract_fixture() -> None:
    fixture = load_fixture("handoff_state.json")

    state = HandoffState.from_dict(fixture)

    assert state.validate() is state
    assert state.from_agent == "Architect"
    assert state.to_dict() == fixture


def test_run_trace_reads_and_writes_shared_contract_fixture() -> None:
    fixture = load_fixture("run_trace.json")

    trace = RunTrace.from_dict(fixture)

    assert trace.run_id == "shared-contract-demo"
    assert len(trace.steps) == 2
    assert trace.handoffs[0].from_agent == "Architect"
    assert trace.to_dict() == fixture


def test_shared_contract_schemas_are_present_and_canonical() -> None:
    schema_dir = CONTRACTS_ROOT / "schemas"
    if not schema_dir.exists():
        pytest.skip("shared contracts folder is not present in this source layout")

    handoff_schema = json.loads((schema_dir / "handoff-state.schema.json").read_text())
    trace_schema = json.loads((schema_dir / "run-trace.schema.json").read_text())

    assert handoff_schema["required"] == ["task", "from_agent", "to_agent"]
    assert "final_output" in trace_schema["properties"]
    assert "run_id" in trace_schema["required"]

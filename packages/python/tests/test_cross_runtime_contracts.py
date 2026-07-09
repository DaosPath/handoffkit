"""Cross-runtime contract tests for Python and JavaScript HandoffKit."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from handoffkit import (
    HandoffQualityReport,
    HandoffState,
    RunTrace,
    ToolCall,
    ToolResult,
    ValidationReport,
    build_contract_parity_report,
)

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


def test_validation_report_reads_and_writes_shared_contract_fixture() -> None:
    fixture = load_fixture("validation_report.json")

    report = ValidationReport.from_dict(fixture)

    assert report.success is False
    assert len(report.issues) == 1
    assert report.issues[0].code == "missing_task"
    assert report.to_dict() == fixture


def test_quality_report_reads_and_writes_shared_contract_fixture() -> None:
    fixture = load_fixture("quality_report.json")

    report = HandoffQualityReport.from_dict(fixture)

    assert report.success is True
    assert report.score == 0.85
    assert len(report.metrics) == 5
    assert report.metrics[3].name == "traceability"
    assert report.to_dict() == fixture


def test_tool_call_reads_and_writes_shared_contract_fixture() -> None:
    fixture = load_fixture("tool_call.json")

    call = ToolCall.from_dict(fixture)

    assert call.tool_name == "add"
    assert call.arguments["a"] == 5
    assert call.call_id == "call-12345"
    assert call.to_dict() == fixture


def test_tool_result_reads_and_writes_shared_contract_fixture() -> None:
    fixture = load_fixture("tool_result.json")

    res = ToolResult.from_dict(fixture)

    assert res.tool_name == "add"
    assert res.success is True
    assert res.result == 15
    assert res.call_id == "call-12345"
    assert res.to_dict() == fixture


def test_shared_contract_schemas_are_present_and_canonical() -> None:
    schema_dir = CONTRACTS_ROOT / "schemas"
    if not schema_dir.exists():
        pytest.skip("shared contracts folder is not present in this source layout")

    handoff_schema = json.loads((schema_dir / "handoff-state.schema.json").read_text())
    trace_schema = json.loads((schema_dir / "run-trace.schema.json").read_text())
    val_schema = json.loads((schema_dir / "validation-report.schema.json").read_text())
    qual_schema = json.loads((schema_dir / "quality-report.schema.json").read_text())
    call_schema = json.loads((schema_dir / "tool-call.schema.json").read_text())
    res_schema = json.loads((schema_dir / "tool-result.schema.json").read_text())
    tool_schema = json.loads((schema_dir / "provider-tool-schema.schema.json").read_text())

    assert handoff_schema["required"] == ["task", "from_agent", "to_agent"]
    assert "final_output" in trace_schema["properties"]
    assert "run_id" in trace_schema["required"]
    assert val_schema["required"] == ["success", "issues", "metadata"]
    assert qual_schema["required"] == [
        "success",
        "score",
        "grade",
        "metrics",
        "recommendations",
        "validation",
    ]
    assert call_schema["required"] == ["tool_name", "arguments", "call_id"]
    assert res_schema["required"] == ["tool_name", "success", "call_id"]
    assert tool_schema["required"] == ["name", "description", "parameters"]


def test_contract_parity_report_covers_shared_contract_inventory() -> None:
    if not CONTRACTS_ROOT.exists():
        pytest.skip("shared contracts folder is not present in this source layout")

    report = build_contract_parity_report(
        runtime="python",
        version="1.10.0",
        contracts_root=CONTRACTS_ROOT,
    )

    assert report.success is True
    assert report.fixture_count == 7
    assert report.schema_count == 7
    assert "handoff_state" in report.supported_contracts
    assert "Contract Parity Report" in report.to_markdown()


def test_contract_parity_report_uses_embedded_inventory_when_installed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import handoffkit.contracts as contracts  # noqa: PLC0415

    monkeypatch.setattr(contracts, "_default_contracts_root", lambda: tmp_path / "missing")

    report = contracts.build_contract_parity_report(runtime="python", version="1.10.0")

    assert report.success is True
    assert report.fixture_count == 7
    assert report.schema_count == 7
    assert report.metadata["source"] == "embedded_inventory"

"""Tests for public MAI-style sequential doctor benchmark."""

from __future__ import annotations

from pathlib import Path

from handoffkit.benchmarks.mai import (
    MAIAction,
    MAIGatekeeper,
    build_mai_style_benchmark,
    build_sequential_doctor_cases,
    run_mai_style_benchmark,
)


def test_build_sequential_cases_have_opening_and_sections() -> None:
    cases = build_sequential_doctor_cases(3)

    assert len(cases) == 3
    assert cases[0].opening
    assert "history" in cases[0].sections
    assert "imaging" in cases[0].sections
    assert cases[0].case.pmcid.startswith("PMC")


def test_gatekeeper_reveals_only_requested_section() -> None:
    case = build_sequential_doctor_cases(1)[0]
    gatekeeper = MAIGatekeeper(case)

    observation = gatekeeper.respond(MAIAction("test", "basic_labs", "basic labs"))

    assert observation.revealed_section == "basic_labs"
    assert "opening" in gatekeeper.revealed
    assert "basic_labs" in gatekeeper.revealed


def test_build_mai_style_benchmark_tracks_cost_handoffs_and_replay() -> None:
    report = build_mai_style_benchmark(3)

    assert report.case_count == 3
    assert report.correct_count == 3
    assert report.accuracy == 1.0
    assert report.total_cost > 0
    assert report.average_cost > 0
    assert report.validation.success is True
    assert report.quality.success is True
    assert len(report.trace.handoffs) == 12
    assert "mai_style_gold_replay" in report.to_json()
    assert "private NEJM SDBench data" in report.to_markdown()


def test_run_mai_style_benchmark_writes_reports(tmp_path: Path) -> None:
    report = run_mai_style_benchmark(
        5,
        output_dir=tmp_path / "runs" / "latest",
        reports_dir=tmp_path / "reports",
    )

    assert report.case_count == 5
    assert (tmp_path / "runs" / "latest" / "report.json").exists()
    assert (tmp_path / "runs" / "latest" / "report.md").exists()
    assert (tmp_path / "runs" / "latest" / "trace.json").exists()
    assert (tmp_path / "reports" / "mai_style_doctor_benchmark_5.json").exists()
    assert (tmp_path / "reports" / "mai_style_doctor_benchmark_5.md").exists()

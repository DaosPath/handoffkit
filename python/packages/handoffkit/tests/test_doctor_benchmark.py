"""Tests for real open-access doctor benchmark harness."""

from __future__ import annotations

from pathlib import Path

from handoffkit.benchmarks.doctor import (
    build_doctor_benchmark,
    load_doctor_benchmark_cases,
    run_doctor_benchmark,
)


def test_load_doctor_benchmark_cases_uses_real_public_metadata() -> None:
    cases = load_doctor_benchmark_cases(30)

    assert len(cases) == 30
    assert all(case.pmcid.startswith("PMC") for case in cases)
    assert all(case.article_link.startswith("https://www.ncbi.nlm.nih.gov/pmc/") for case in cases)
    assert all(case.case_prompt for case in cases)
    assert all(case.final_diagnosis for case in cases)


def test_load_doctor_benchmark_cases_supports_400_case_fixture() -> None:
    cases = load_doctor_benchmark_cases(400)

    assert len(cases) == 400
    assert cases[0].case_id.startswith("medcase400-")
    assert cases[-1].case_id == "medcase400-0399"
    assert len({case.final_diagnosis.lower() for case in cases}) >= 390


def test_build_doctor_benchmark_creates_replayable_handoffs() -> None:
    report = build_doctor_benchmark(3)

    assert report.case_count == 3
    assert report.correct_count == 3
    assert report.accuracy == 1.0
    assert report.validation.success is True
    assert report.quality.success is True
    assert len(report.trace.handoffs) == 6
    assert "gold_replay" in report.to_json()


def test_run_doctor_benchmark_writes_reports(tmp_path: Path) -> None:
    report = run_doctor_benchmark(
        5,
        output_dir=tmp_path / "runs" / "latest",
        reports_dir=tmp_path / "reports",
    )

    assert report.case_count == 5
    assert (tmp_path / "runs" / "latest" / "report.json").exists()
    assert (tmp_path / "runs" / "latest" / "report.md").exists()
    assert (tmp_path / "runs" / "latest" / "trace.json").exists()
    assert (tmp_path / "reports" / "doctor_benchmark_5.json").exists()
    assert (tmp_path / "reports" / "doctor_benchmark_5.md").exists()

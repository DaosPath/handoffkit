"""Independent protocol benchmark (published methodology, no leaderboard)."""

from __future__ import annotations

import json
from pathlib import Path

from handoffkit.benchmarks.independent import (
    METHODOLOGY_ID,
    METHODOLOGY_VERSION,
    PROTOCOL_TASKS_V1,
    build_independent_benchmark,
    methodology_manifest,
    run_independent_benchmark,
)


def test_methodology_manifest_is_stable() -> None:
    m = methodology_manifest()
    assert m["methodology_id"] == METHODOLOGY_ID
    assert m["methodology_version"] == METHODOLOGY_VERSION
    assert m["leaderboard"] is False
    assert len(m["tasks"]) == len(PROTOCOL_TASKS_V1)
    assert all("task_id" in t and "description_sha256" in t for t in m["tasks"])


def test_build_independent_benchmark_offline() -> None:
    report = build_independent_benchmark()
    assert report.task_count == 5
    assert report.tasks_passed == 5
    assert report.success is True
    assert report.metadata.get("leaderboard") is False
    assert report.validation is not None and report.validation.success
    assert report.quality is not None and report.quality.score >= 0.5
    assert report.metrics is not None
    payload = report.to_dict()
    assert payload["kind"] == "independent_protocol_benchmark"
    assert payload["metadata"]["leaderboard"] is False
    assert "Independent Protocol Benchmark" in report.to_markdown()
    assert "Not a public leaderboard" in report.to_markdown()


def test_run_writes_artifacts(tmp_path: Path) -> None:
    out = tmp_path / "runs"
    reports = tmp_path / "reports"
    report = run_independent_benchmark(output_dir=out, reports_dir=reports)
    assert (out / "independent_benchmark.json").is_file()
    assert (out / "independent_methodology.json").is_file()
    assert (out / "independent_benchmark.md").is_file()
    manifest = json.loads((out / "independent_methodology.json").read_text(encoding="utf-8"))
    assert manifest["methodology_id"] == METHODOLOGY_ID
    assert report.artifacts
    repo = list(reports.glob("independent_protocol_benchmark.*"))
    assert len(repo) >= 2


def test_task_id_filter() -> None:
    report = build_independent_benchmark(task_ids=["proto-001", "proto-003"])
    assert report.task_count == 2
    assert {t.task_id for t in report.tasks} == {"proto-001", "proto-003"}

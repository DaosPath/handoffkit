"""Model-answer judge tests (parity with js/packages/browser/test/model-answer.test.js)."""

from __future__ import annotations

import json
from pathlib import Path

from handoffkit.browser import judge_model_answer
from handoffkit.browser import model_answer as model_answer_module

FIXTURE_PATH = (
    Path(__file__).resolve().parents[4]
    / "shared"
    / "contracts"
    / "conformance"
    / "model-answer-v1.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_judge_is_exported_from_browser_package() -> None:
    assert model_answer_module.judge_model_answer is judge_model_answer


def test_fixture_cases() -> None:
    assert FIXTURE["format"] == "handoffkit.browser.model_answer_conformance"
    for case in FIXTURE["cases"]:
        report = judge_model_answer(case["transcript"])
        assert report["format"] == "handoffkit.browser.model_answer_judgment"
        assert report["format_version"] == 1
        assert report["verdict"] == case["expected"]["verdict"], case["name"]
        assert report["score"] == case["expected"]["score"], case["name"]
        assert len(report["gates"]) == 5
        if "failing_gates" in case["expected"]:
            failed = [gate["id"] for gate in report["gates"] if gate["result"] == "fail"]
            assert failed == case["expected"]["failing_gates"], case["name"]


def test_judge_rejects_non_object_input_fail_closed() -> None:
    assert judge_model_answer(None)["verdict"] == "fail"


def test_fuzzy_cases() -> None:
    for case in FIXTURE.get("fuzzy_cases", []):
        fuzzy = judge_model_answer(case["transcript"], {"mode": "fuzzy"})
        assert fuzzy["mode"] == "fuzzy"
        assert fuzzy["verdict"] == case["expected"]["verdict"], case["name"]
        assert fuzzy["score"] == case["expected"]["score"], case["name"]
        if "failing_gates" in case["expected"]:
            failed = [gate["id"] for gate in fuzzy["gates"] if gate["result"] == "fail"]
            assert failed == case["expected"]["failing_gates"], case["name"]
        if case["name"] == "paraphrase_passes_fuzzy":
            assert judge_model_answer(case["transcript"])["verdict"] == "fail"

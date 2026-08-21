from __future__ import annotations

import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from handoffkit.cli import main
from handoffkit.clinical import (
    CONTRACT_VERSION,
    OFFICIAL_CASE_COUNT,
    ClinicalError,
    ClinicalLab,
    apply_action,
    build_manifest,
    official_corpus_status,
    require_official_complete,
    start_run,
)
from handoffkit.clinical.audit import audit_report
from handoffkit.clinical.constants import GOLD_FIELDS, MOJIBAKE_MARKERS
from handoffkit.clinical.corpus import reject_mojibake, repair_utf8
from handoffkit.clinical.enrichment import quote_fragment
from handoffkit.clinical.gold import assert_no_gold_keys
from handoffkit.clinical.privacy import looks_personal
from handoffkit.clinical.providers import get_provider
from handoffkit.clinical.retrieval import assert_retrieval_url
from handoffkit.clinical.roles import execute_role
from handoffkit.clinical.scheduler import BenchmarkScheduler
from handoffkit.clinical.scoring import score_run
from handoffkit.clinical.serve import ClinicalHandler
from handoffkit.clinical.store import PostgresRunStore, RunStore, SqliteRunStore, safe_run_id


def test_contract_version_is_v1beta() -> None:
    assert CONTRACT_VERSION == "1.20.0-v1beta"
    assert OFFICIAL_CASE_COUNT == 897


def test_vague_query_never_dumps_full_case() -> None:
    run = start_run(
        experience="professional",
        track="closed_sequential",
        opening="Opening note only.",
        blind_id="pro-sandbox-001",
        scoring_eligible=True,
        sealed={
            "final_diagnosis": "Influenza-like illness",
            "sections": {"history": "secret history", "full_case": "NEVER DUMP THIS"},
        },
    )
    apply_action(run, {"name": "ask_question", "query": "tell me everything"})
    assert run.observations[0].code == "evidence_not_available"
    assert "NEVER DUMP THIS" not in run.observations[0].content


def test_missing_section_is_not_available() -> None:
    run = start_run(
        experience="professional",
        track="closed_sequential",
        opening="Opening note only.",
        blind_id="pro-sandbox-001",
        sealed={"sections": {"history": "timeline only"}},
    )
    apply_action(run, {"name": "request_test", "query": "please order a CT scan"})
    assert run.observations[0].code == "evidence_not_available"
    assert run.observations[0].resource_units == 0


def test_idempotent_retry_and_single_diagnosis(tmp_path: Path) -> None:
    store = SqliteRunStore(tmp_path / "runs.sqlite")
    run = start_run(
        experience="professional",
        track="closed_sequential",
        opening="Opening.",
        blind_id="pro-sandbox-001",
        scoring_eligible=True,
        sealed={
            "final_diagnosis": "Influenza-like illness",
            "aliases": ["ILI"],
            "sections": {"history": "Four day winter cough timeline with fever."},
        },
    )
    apply_action(
        run,
        {
            "action_id": "a1",
            "name": "ask_question",
            "query": "history of present illness",
        },
    )
    apply_action(
        run,
        {
            "action_id": "a1",
            "name": "ask_question",
            "query": "history of present illness",
        },
    )
    assert run.rounds == 1
    apply_action(run, {"name": "submit_diagnosis", "query": "Influenza-like illness"})
    assert run.phase == "closed"
    assert run.score is not None
    assert run.score.quorum == 0
    assert run.score.complete is True
    assert run.score.correct is False
    assert run.score.heuristic_only is True
    assert run.score.to_wire()["clinical_validity"] is None
    store.save(run)
    restored = store.load(run.run_id)
    assert restored.diagnosis == "Influenza-like illness"
    with pytest.raises(ClinicalError) as exc:
        apply_action(restored, {"name": "submit_diagnosis", "query": "again"})
    assert exc.value.code == "invalid_transition"


def test_gold_leak_detected() -> None:
    run = start_run(
        experience="professional",
        track="closed_sequential",
        opening="Opening.",
        blind_id="x",
        sealed={"final_diagnosis": "SecretGoldDxLabel", "pmcid": "PMC9999999"},
    )
    with pytest.raises(ClinicalError) as exc:
        apply_action(run, {"name": "ask_question", "query": "is it SecretGoldDxLabel"})
    assert exc.value.code == "gold_leak_detected"


def test_official_builder_rejects_wrong_count() -> None:
    with pytest.raises(ClinicalError) as exc:
        build_manifest([{"pmcr_question": "too short"}] * 3)
    assert exc.value.code == "run_incomplete"


def test_official_builder_keeps_all_897_and_flags_quality() -> None:
    rows = []
    for index in range(OFFICIAL_CASE_COUNT):
        rows.append(
            {
                "pmcid": f"PMC{1000000 + index}",
                "title": f"Case {index}",
                "pmcr_question": (
                    "Adult presents with fever and cough after travel. "
                    f"Figure mentioned in case {index}."
                ),
                "final_diagnosis": (
                    "Viral illness" if index % 10 else "Viral illness versus bacterial"
                ),
                "diagnostic_reasoning": "sandbox",
                "article_link": f"https://example.invalid/{index}",
            }
        )
    manifest = build_manifest(rows, revision="a" * 40)
    assert manifest["count"] == 897
    assert len(manifest["cases"]) == 897
    flags = {flag for case in manifest["cases"] for flag in case["quality_flags"]}
    assert "image_required" in flags
    assert "duplicate" in flags
    assert "ambiguity" in flags


def test_mojibake_repair_and_reject() -> None:
    repaired = repair_utf8("cafÃ©")
    assert "é" in repaired or repaired == "cafÃ©"
    with pytest.raises(ClinicalError):
        reject_mojibake(f"bad {MOJIBAKE_MARKERS[0]} leftover", field="opening")


def test_enrichment_requires_literal_quote() -> None:
    document = "Creatinine was 1.1 mg/dL on hospital day 2."
    quoted = quote_fragment(document, "Creatinine was 1.1 mg/dL", section="basic_labs")
    assert quoted["quote"] == "Creatinine was 1.1 mg/dL"
    assert quoted["source_hash"]
    with pytest.raises(ClinicalError) as exc:
        quote_fragment(document, "invented troponin 99", section="basic_labs")
    assert exc.value.code == "evidence_not_available"


def test_retrieval_blocks_private_and_source() -> None:
    run = start_run(
        experience="professional",
        track="retrieval_assisted",
        opening="Opening.",
        blind_id="x",
        sealed={
            "pmcid": "PMC1234567",
            "article_link": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/",
        },
    )
    with pytest.raises(ClinicalError) as exc:
        assert_retrieval_url("http://127.0.0.1/secret", run)
    assert exc.value.code == "retrieval_blocked"


def test_scheduler_resume_does_not_duplicate(tmp_path: Path) -> None:
    cases = [{"blind_id": f"mcr-{i:04d}", "status": "pending"} for i in range(1, 898)]
    sched = BenchmarkScheduler(tmp_path / "bench.sqlite")
    sched.seed(cases, track="closed_sequential")
    sched.seed(cases, track="closed_sequential")
    sched.checkpoint(
        "mcr-0001",
        {"blind_id": "mcr-0001", "status": "complete", "score": {"quorum": 3}},
    )
    pending = sched.pending()
    assert len(pending) == 896
    with pytest.raises(ClinicalError) as exc:
        sched.complete_or_raise()
    assert exc.value.code == "run_incomplete"


def test_official_complete_gate() -> None:
    with pytest.raises(ClinicalError):
        require_official_complete([{"status": "complete", "score": {"quorum": 3}}])


def test_lab_public_rejects_personal_input() -> None:
    lab = ClinicalLab()
    with pytest.raises(ClinicalError) as exc:
        lab.create_run({"experience": "public", "symptoms": "I have chest pain"})
    assert exc.value.code == "personal_input_rejected"
    run = lab.create_run({"experience": "public", "blind_id": "sim-public-001"})
    assert run.scoring_eligible is False
    assert run.differential
    wire = run.to_wire()
    assert "sealed" not in wire
    assert "pmcid" not in json.dumps(wire)


def test_lab_official_benchmark_is_incomplete() -> None:
    lab = ClinicalLab()
    with pytest.raises(ClinicalError) as exc:
        lab.start_benchmark({"official": True})
    assert exc.value.code == "run_incomplete"


def test_audit_rejects_gold_replay_accuracy() -> None:
    with pytest.raises(ClinicalError):
        audit_report({"mode": "gold_replay", "accuracy": 1.0})


def test_cli_clinical_help_and_run(capsys) -> None:  # type: ignore[no-untyped-def]
    assert main(["clinical"]) == 0
    output = capsys.readouterr().out
    assert "clinical serve" in output
    assert main(["clinical", "run", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["blind_id"] == "pro-sandbox-001"
    assert payload["scoring_eligible"] is True
    assert main(["clinical", "benchmark", "--official"]) == 1
    failed = json.loads(capsys.readouterr().out)
    assert failed["code"] == "run_incomplete"


def _pro_run(**kwargs):
    sealed = {
        "final_diagnosis": "Influenza-like illness",
        "aliases": ["ILI"],
        "title": "sandbox-winter-respiratory",
        "pmcid": "PMC9999999",
        "article_link": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9999999/",
        "diagnostic_reasoning": "secret reasoning vault",
        "sections": {
            "history": (
                "Post-flight winter onset over four days with fever then lingering "
                "dry cough and a long evidence card used to pad coverage heuristics."
            )
        },
    }
    sealed.update(kwargs.pop("sealed", {}))
    return start_run(
        experience="professional",
        track="closed_sequential",
        opening="Opening note only.",
        blind_id="pro-sandbox-001",
        scoring_eligible=True,
        sealed=sealed,
        **kwargs,
    )


def test_false_diagnosis_is_never_correct_from_coverage() -> None:
    run = _pro_run()
    apply_action(run, {"name": "ask_question", "query": "history of present illness"})
    apply_action(
        run, {"name": "submit_diagnosis", "query": "Completely fabricated zeolite poisoning"}
    )
    assert run.score is not None
    assert run.score.correct is False
    assert run.score.exact_match is False
    assert run.score.alias_match is False
    assert run.score.heuristic_only is True
    assert run.score.judge_scores == []
    assert run.score.to_wire()["clinical_validity"] is None


def test_false_diagnosis_within_budget_is_still_incorrect() -> None:
    run = _pro_run()
    apply_action(run, {"name": "submit_diagnosis", "query": "WrongDxLabel"})
    assert run.spent_units <= run.budget_units
    assert run.score is not None
    assert run.score.correct is False


def test_exact_and_alias_are_regression_only() -> None:
    exact = _pro_run()
    apply_action(exact, {"name": "submit_diagnosis", "query": "Influenza-like illness"})
    assert exact.score is not None
    assert exact.score.exact_match is True
    assert exact.score.correct is False
    alias = _pro_run()
    apply_action(alias, {"name": "submit_diagnosis", "query": "ILI"})
    assert alias.score is not None
    assert alias.score.alias_match is True
    assert alias.score.correct is False


def test_empty_diagnosis_is_incorrect() -> None:
    run = _pro_run()
    apply_action(run, {"name": "submit_diagnosis", "query": ""})
    assert run.score is not None
    assert run.score.correct is False
    assert run.score.exact_match is False


def test_missing_and_failing_judges_fail_closed() -> None:
    run = _pro_run()
    run.diagnosis = "Influenza-like illness"
    missing = score_run(run, [])
    assert missing.complete is False
    assert missing.correct is False
    assert missing.quorum == 0

    def boom(_run):
        raise RuntimeError("judge exploded")

    failing = score_run(run, [boom, lambda _r: 5, lambda _r: 5])
    assert failing.complete is False
    assert failing.correct is False


def test_ineligible_and_gold_replay_never_count_as_accuracy() -> None:
    public = start_run(
        experience="public",
        track="closed_sequential",
        opening="sim",
        blind_id="sim-public-001",
        sealed={"final_diagnosis": "Influenza-like illness"},
        scoring_eligible=True,
    )
    apply_action(public, {"name": "submit_diagnosis", "query": "Influenza-like illness"})
    assert public.scoring_eligible is False
    assert public.score is not None
    assert public.score.scoring_mode == "ineligible"
    assert public.score.correct is False
    lab = ClinicalLab()
    replay = lab.create_run({"replay": True, "fixture_id": "clinical-recorded-run-v1"})
    assert replay.source == "recorded_fixture"
    assert replay.replay is True
    assert replay.score is not None
    assert replay.score.scoring_mode == "gold_replay"
    assert replay.score.correct is False


def test_personal_input_rejected_on_create_and_action_without_persist() -> None:
    lab = ClinicalLab()
    samples = [
        {
            "experience": "professional",
            "blind_id": "pro-sandbox-001",
            "symptoms": "I have chest pain",
        },
        {"experience": "professional", "blind_id": "pro-sandbox-001", "personal_input": True},
        {"experience": "professional", "blind_id": "pro-sandbox-001", "email": "ada@example.com"},
    ]
    for body in samples:
        with pytest.raises(ClinicalError) as exc:
            lab.create_run(body)
        assert exc.value.code == "personal_input_rejected"
        assert "ada@example.com" not in json.dumps(exc.value.to_wire())
        assert "chest pain" not in json.dumps(exc.value.to_wire())
    assert lab.store.list_ids() == []
    run = lab.create_run({"experience": "professional", "blind_id": "pro-sandbox-001"})
    attacks = [
        "My name is Jane Doe",
        "Call me at 555-123-4567",
        "email patient@example.com",
        "I live at 123 Main Street",
        "SSN 123-45-6789",
        "I have chest pain and fever",
        "me duele el pecho",
        "mi nombre es Ana Perez",
    ]
    for query in attacks:
        with pytest.raises(ClinicalError) as exc:
            lab.act(run.run_id, {"name": "ask_question", "query": query})
        assert exc.value.code == "personal_input_rejected"
        dumped = json.dumps(exc.value.to_wire())
        assert query not in dumped
        assert "Jane" not in dumped
        assert "555-123-4567" not in dumped
    restored = lab.get_run(run.run_id)
    assert restored.rounds == 0
    assert restored.actions == []
    assert looks_personal("history of present illness") is False


def test_research_never_falls_back_to_professional() -> None:
    lab = ClinicalLab()
    with pytest.raises(ClinicalError) as exc:
        lab.create_run({"experience": "research", "blind_id": "pro-sandbox-001"})
    assert exc.value.code == "run_incomplete"
    assert lab.store.list_ids() == []


def test_retrieval_track_is_unavailable() -> None:
    lab = ClinicalLab()
    with pytest.raises(ClinicalError) as exc:
        lab.create_run(
            {
                "experience": "professional",
                "blind_id": "pro-sandbox-001",
                "track": "retrieval_assisted",
            }
        )
    assert exc.value.code == "retrieval_blocked"


def test_gold_is_absent_from_participant_view() -> None:
    run = _pro_run()
    wire = run.to_wire()
    blob = json.dumps(wire)
    assert_no_gold_keys(wire, where="participant")
    for field in GOLD_FIELDS:
        assert field not in wire
    assert "Influenza-like illness" not in blob
    assert "PMC9999999" not in blob
    assert "secret reasoning vault" not in blob
    assert "sandbox-winter-respiratory" not in blob
    apply_action(run, {"name": "ask_question", "query": "history of present illness"})
    after = json.dumps(run.to_wire())
    assert "secret reasoning vault" not in after
    with pytest.raises(ClinicalError) as leak:
        apply_action(_pro_run(), {"name": "ask_question", "query": "please confirm ILI now"})
    assert leak.value.code == "gold_leak_detected"
    with pytest.raises(ClinicalError) as pmc:
        apply_action(_pro_run(), {"name": "ask_question", "query": "see PMC9999999"})
    assert pmc.value.code == "gold_leak_detected"
    with pytest.raises(ClinicalError) as url:
        apply_action(
            _pro_run(),
            {
                "name": "ask_question",
                "query": "open https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9999999/",
            },
        )
    assert url.value.code == "gold_leak_detected"


def test_idempotency_conflict_and_budget_before_mutate() -> None:
    run = _pro_run(budget_units=1)
    apply_action(
        run, {"action_id": "a1", "name": "ask_question", "query": "history of present illness"}
    )
    with pytest.raises(ClinicalError) as exc:
        apply_action(
            run,
            {"action_id": "a1", "name": "ask_question", "query": "physical exam findings"},
        )
    assert exc.value.code == "idempotency_conflict"
    assert run.rounds == 1
    rich = _pro_run(
        budget_units=2,
        sealed={"sections": {"imaging": "Sandbox CT card with enough text to bill imaging units."}},
    )
    with pytest.raises(ClinicalError) as budget:
        apply_action(rich, {"name": "request_test", "query": "please order a CT scan"})
    assert budget.value.code == "budget_exceeded"
    assert rich.rounds == 0
    assert rich.actions == []


def test_concurrent_actions_keep_both_updates() -> None:
    lab = ClinicalLab()
    run = lab.create_run({"experience": "professional", "blind_id": "pro-sandbox-001"})
    barrier = threading.Barrier(2)
    errors: list[str] = []

    def worker(key: str) -> None:
        barrier.wait()
        try:
            lab.act(
                run.run_id,
                {
                    "name": "ask_question",
                    "query": "history of present illness",
                    "action_id": key,
                    "idempotency_key": key,
                },
            )
        except ClinicalError as exc:
            errors.append(exc.code)

    threads = [
        threading.Thread(target=worker, args=("c1",)),
        threading.Thread(target=worker, args=("c2",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    restored = lab.get_run(run.run_id)
    assert restored.rounds == 2
    assert errors == []


def test_durable_store_checksum_quarantine_and_close(tmp_path: Path) -> None:
    store = RunStore(tmp_path / "runs")
    run = _pro_run()
    store.save(run)
    restored = store.load(run.run_id)
    assert restored.run_id == run.run_id
    path = tmp_path / "runs" / f"{run.run_id}.json"
    path.write_text("{not-json", encoding="utf-8")
    with pytest.raises(ClinicalError) as exc:
        store.load(run.run_id)
    assert exc.value.code == "store_corrupt"
    assert (tmp_path / "runs" / "quarantine" / f"{run.run_id}.json").is_file()
    backup = store.backup(tmp_path / "backup")  # noqa: F841
    store.close()
    with pytest.raises(ClinicalError):
        store.save(run)
    with pytest.raises(ClinicalError):
        PostgresRunStore("postgres://example.invalid/clinical")
    with pytest.raises(ClinicalError):
        safe_run_id("../etc/passwd")


def test_scheduler_missing_checkpoint_and_incompatible_track(tmp_path: Path) -> None:
    cases = [{"blind_id": f"mcr-{i:04d}", "status": "pending"} for i in range(1, 898)]
    sched = BenchmarkScheduler(tmp_path / "bench.sqlite")
    sched.seed(cases, track="closed_sequential", corpus_revision="a" * 40)
    with pytest.raises(ClinicalError) as exc:
        sched.checkpoint("missing-id", {"status": "complete"})
    assert exc.value.code == "checkpoint_missing"
    with pytest.raises(ClinicalError):
        sched.seed(cases, track="retrieval_assisted", corpus_revision="a" * 40)


def test_roles_and_providers_are_unavailable_scaffolds() -> None:
    with pytest.raises(ClinicalError) as role:
        execute_role("hypothesis", "propose")
    assert role.value.code == "provider_unavailable"
    assert role.value.details.get("available") is False
    with pytest.raises(ClinicalError) as provider:
        get_provider("ollama").generate("hello")
    assert provider.value.code == "provider_unavailable"
    assert official_corpus_status()["sha256"] is None
    assert official_corpus_status()["available"] is False


def test_http_snapshot_and_personal_rejection() -> None:
    lab = ClinicalLab()
    handler = type(
        "Bound",
        (ClinicalHandler,),
        {"lab": lab, "bind_loopback": True, "_hits": {}},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = int(server.server_address[1])
        conn = HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request(
            "POST",
            "/api/clinical/v1beta/runs",
            json.dumps({"experience": "research", "blind_id": "pro-sandbox-001"}),
            {"Content-Type": "application/json", "Host": "127.0.0.1"},
        )
        research = json.loads(conn.getresponse().read())
        assert research["code"] == "run_incomplete"
        conn.request(
            "POST",
            "/api/clinical/v1beta/runs",
            json.dumps(
                {
                    "experience": "professional",
                    "blind_id": "pro-sandbox-001",
                    "symptoms": "I have chest pain",
                }
            ),
            {"Content-Type": "application/json", "Host": "127.0.0.1"},
        )
        personal = json.loads(conn.getresponse().read())
        assert personal["code"] == "personal_input_rejected"
        assert "chest" not in json.dumps(personal)
        conn.request(
            "POST",
            "/api/clinical/v1beta/runs",
            json.dumps({"experience": "professional", "blind_id": "pro-sandbox-001"}),
            {"Content-Type": "application/json", "Host": "127.0.0.1"},
        )
        created = json.loads(conn.getresponse().read())
        run_id = created["run_id"]
        conn.request(
            "GET", f"/api/clinical/v1beta/runs/{run_id}/events", headers={"Host": "127.0.0.1"}
        )
        events = json.loads(conn.getresponse().read())
        assert events["stream"] == "snapshot"
        assert "sealed" not in json.dumps(events)
        conn.request("GET", "/api/clinical/v1beta/runs/..%2Fsecret", headers={"Host": "127.0.0.1"})
        traversal = json.loads(conn.getresponse().read())
        assert traversal["code"] == "invalid_request"
    finally:
        server.shutdown()
        server.server_close()

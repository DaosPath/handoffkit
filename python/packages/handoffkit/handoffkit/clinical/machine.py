"""Sequential diagnosis state machine. Gold stays in the vault, not on the run."""

from __future__ import annotations

from uuid import uuid4

from handoffkit.clinical.constants import STATUS_PUBLIC
from handoffkit.clinical.costs import usd_profile
from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.gatekeeper import respond
from handoffkit.clinical.gold import GoldVault, gold_leak_fields, split_sealed
from handoffkit.clinical.leak import collect_preclose_text
from handoffkit.clinical.models import ClinicalAction, ClinicalErrorModel, ClinicalRun
from handoffkit.clinical.privacy import reject_act_payload
from handoffkit.clinical.roles import execute_role
from handoffkit.clinical.scoring import score_run

DEFAULT_VAULT = GoldVault()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def start_run(
    *,
    experience: str,
    track: str,
    opening: str,
    blind_id: str,
    sealed: dict | None = None,
    locale: str = "en",
    replay: bool = False,
    scoring_eligible: bool = False,
    budget_units: int = 40,
    max_rounds: int = 12,
    run_id: str = "",
    differential: list | None = None,
    vault: GoldVault | None = None,
    source: str = "live_sandbox",
    fixture_id: str = "",
) -> ClinicalRun:
    if experience == "public":
        scoring_eligible = False
    evidence, gold, operational = split_sealed(sealed)
    payload = {
        "run_id": run_id or _new_id("run"),
        "experience": experience,
        "track": track,
        "phase": "deliberate",
        "status": "running",
        "blind_id": blind_id,
        "opening": opening,
        "budget_units": budget_units,
        "max_rounds": max_rounds,
        "replay": replay,
        "scoring_eligible": scoring_eligible,
        "status_public": STATUS_PUBLIC,
        "locale": locale,
        "sealed": operational,
        "evidence": evidence,
        "differential": list(differential or []),
        "source": "recorded_fixture" if replay else source,
        "fixture_id": fixture_id,
        "revision": 0,
    }
    run = ClinicalRun(payload)
    target = vault or DEFAULT_VAULT
    target.seal(run.run_id, gold)
    return run


def apply_action(
    run: ClinicalRun,
    raw: dict,
    *,
    vault: GoldVault | None = None,
    judges: list | None = None,
) -> ClinicalRun:
    reject_act_payload(raw)
    if run.phase == "closed":
        raise ClinicalError("run is closed", code="invalid_transition")
    if "expected_revision" in raw and int(raw["expected_revision"]) != run.revision:
        raise ClinicalError("run revision conflict", code="revision_conflict")
    action = ClinicalAction(raw)
    if action.role:
        execute_role(action.role, action.query)
    if not action.action_id:
        action.action_id = _new_id("act")
        if not action.idempotency_key:
            action.idempotency_key = action.action_id
    existing = next(
        (
            item
            for item in run.actions
            if item.idempotency_key and item.idempotency_key == action.idempotency_key
        ),
        None,
    )
    if existing:
        if existing.name != action.name or existing.query != action.query:
            raise ClinicalError(
                "idempotency key reused with a different payload",
                code="idempotency_conflict",
            )
        return run
    if action.name == "submit_diagnosis" and run.diagnosis:
        raise ClinicalError("diagnosis already submitted", code="invalid_transition")
    if run.rounds >= run.max_rounds and action.name != "submit_diagnosis":
        raise ClinicalError("round limit reached", code="budget_exceeded")
    if action.name in {"ask_question", "request_test"}:
        if run.phase != "deliberate":
            raise ClinicalError(
                f"expected deliberate, found {run.phase}",
                code="invalid_transition",
            )
    elif action.name == "submit_diagnosis":
        if run.phase not in {"deliberate", "update_differential"}:
            raise ClinicalError("cannot submit now", code="invalid_transition")
    else:
        raise ClinicalError("unsupported action", code="invalid_transition")

    observation = respond(run, action, _new_id("obs"))
    spent = run.spent_units + int(observation.resource_units)
    if spent > run.budget_units:
        raise ClinicalError("resource budget exceeded", code="budget_exceeded")
    gold_vault = vault or DEFAULT_VAULT
    probe = collect_preclose_text(run)
    if action.name != "submit_diagnosis":
        probe = f"{probe}\n{action.query}"
    probe = f"{probe}\n{observation.content}\n{observation.source_fragment}"
    leaked = gold_leak_fields(probe, gold_vault.get(run.run_id))
    if leaked:
        raise ClinicalError(
            "gold metadata leaked before close",
            code="gold_leak_detected",
            details={"fields": leaked},
        )

    if action.name in {"ask_question", "request_test"}:
        run.phase = action.name
    else:
        run.phase = "submit_diagnosis"
    run.actions.append(action)
    run.phase = "gatekeeper"
    run.phase = "cost"
    run.spent_units = spent
    run.observations.append(observation)
    run.rounds += 1
    run.revision += 1
    if action.name == "submit_diagnosis":
        run.diagnosis = action.query
        run.phase = "score"
        run.score = score_run(run, judges, vault=gold_vault)
        run.phase = "closed"
        if run.score and run.score.complete:
            run.status = "complete"
        else:
            run.status = "incomplete"
            run.error = ClinicalErrorModel(
                {
                    "code": "judge_quorum_missing",
                    "message": "independent judges unavailable or incomplete",
                }
            )
    else:
        run.phase = "deliberate"
    run.sealed["usd_profile"] = usd_profile(run.spent_units, enabled=False)
    return run

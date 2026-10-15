"""Evidence gatekeeper: never dumps the full case; missing facts stay unavailable."""

from __future__ import annotations

from hashlib import sha256

from handoffkit.clinical.costs import is_vague, units_for
from handoffkit.clinical.models import ClinicalAction, ClinicalObservation, ClinicalRun


def _hash(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


def _section_for(action: ClinicalAction) -> str:
    query = f"{action.name} {action.query}".lower()
    if action.name == "submit_diagnosis":
        return "diagnosis_submission"
    mapping = (
        ("pathology", ("pathology", "biopsy", "histology", "specimen")),
        ("imaging", ("imaging", "ct", "mri", "ultrasound", "radiograph", "oct")),
        ("basic_labs", ("lab", "serum", "blood", "creatinine", "count")),
        ("special_tests", ("genetic", "antibody", "pcr", "serologic", "special")),
        ("physical_exam", ("exam", "physical")),
        ("history", ("history", "timeline", "onset")),
    )
    for section, needles in mapping:
        if any(needle in query for needle in needles):
            return section
    return ""


def respond(run: ClinicalRun, action: ClinicalAction, observation_id: str) -> ClinicalObservation:
    sections = dict((run.evidence or {}).get("sections") or run.sealed.get("sections") or {})
    if action.name == "submit_diagnosis":
        return ClinicalObservation(
            {
                "observation_id": observation_id,
                "action_id": action.action_id,
                "section": "diagnosis_submission",
                "content": "Diagnosis submitted.",
                "resource_units": 0,
            }
        )
    if is_vague(f"{action.name} {action.query}"):
        return ClinicalObservation(
            {
                "observation_id": observation_id,
                "action_id": action.action_id,
                "section": "not_available",
                "content": "evidence_not_available",
                "code": "evidence_not_available",
                "resource_units": 0,
            }
        )
    section = _section_for(action)
    content = str(sections.get(section) or "")
    if not section or not content.strip() or section == "full_case":
        return ClinicalObservation(
            {
                "observation_id": observation_id,
                "action_id": action.action_id,
                "section": "not_available",
                "content": "evidence_not_available",
                "code": "evidence_not_available",
                "resource_units": 0,
            }
        )
    fragment = content[:240]
    return ClinicalObservation(
        {
            "observation_id": observation_id,
            "action_id": action.action_id,
            "section": section,
            "content": content,
            "source_hash": _hash(content),
            "source_fragment": fragment,
            "resource_units": units_for(action, section),
        }
    )

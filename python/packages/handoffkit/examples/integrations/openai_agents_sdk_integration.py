"""Dependency-optional OpenAI Agents SDK handoff adapter example.

This example does not call the OpenAI API. It shows the adapter boundary:
model/tool orchestration can live in the Agents SDK, while HandoffKit preserves
the handoff payload as a validated, auditable contract.
"""

from __future__ import annotations

from typing import Any

from handoffkit import HandoffState, HandoffStateValidator


def handoff_to_markdown(handoff: HandoffState) -> str:
    """Render the important handoff fields for the terminal demo."""
    return (
        f"## {handoff.from_agent} -> {handoff.to_agent}\n\n"
        f"Task: {handoff.task}\n\n"
        f"Summary: {handoff.summary}\n\n"
        "Decisions:\n"
        + "\n".join(f"- {item}" for item in handoff.decisions)
        + "\n\nFiles:\n"
        + "\n".join(f"- `{item}`" for item in handoff.important_files)
        + "\n\nErrors:\n"
        + "\n".join(f"- {item}" for item in handoff.errors)
        + "\n\nNext steps:\n"
        + "\n".join(f"- {item}" for item in handoff.next_steps)
    )


def build_agents_sdk_handoff_payload(
    *,
    previous_agent: str,
    next_agent: str,
    task: str,
    sdk_context: dict[str, Any],
) -> dict[str, Any]:
    """Return a dict safe to pass through an SDK handoff callback."""
    handoff = HandoffState(
        task=task,
        from_agent=previous_agent,
        to_agent=next_agent,
        summary=str(sdk_context.get("summary", "Escalate with structured evidence.")),
        decisions=list(sdk_context.get("decisions", [])),
        important_files=list(sdk_context.get("important_files", [])),
        errors=list(sdk_context.get("errors", [])),
        next_steps=list(sdk_context.get("next_steps", [])),
        context_refs=list(sdk_context.get("context_refs", [])),
        metadata={
            "integration": "openai-agents-sdk",
            "source_run_id": sdk_context.get("run_id", "offline-demo"),
            "errors_checked": bool(sdk_context.get("errors_checked", True)),
        },
    )
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return handoff.to_dict()


def receive_agents_sdk_handoff_payload(payload: dict[str, Any]) -> HandoffState:
    """Validate incoming SDK handoff data before the next agent uses it."""
    handoff = HandoffState.from_dict(payload).validate()
    HandoffStateValidator().validate(handoff).raise_if_failed()
    return handoff


def main() -> None:
    payload = build_agents_sdk_handoff_payload(
        previous_agent="Triage",
        next_agent="Billing",
        task="Resolve a duplicate charge complaint.",
        sdk_context={
            "summary": "Customer reports duplicate invoice charge; billing should verify IDs.",
            "decisions": ["Do not promise refund before charge IDs are verified."],
            "important_files": ["ticket.json", "billing_events.csv"],
            "errors": ["Customer supplied one screenshot without transaction ID."],
            "next_steps": ["Match invoice ID", "Check duplicate processor event", "Draft response"],
            "context_refs": ["ticket-1842", "stripe-event-search"],
            "run_id": "agents-sdk-offline-demo",
        },
    )
    handoff = receive_agents_sdk_handoff_payload(payload)
    print("# OpenAI Agents SDK Integration Example")
    print()
    print("Runs offline and demonstrates the HandoffState payload boundary.")
    print()
    print(handoff_to_markdown(handoff))


if __name__ == "__main__":
    main()

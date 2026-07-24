"""1.14.2 mini-demo: offline fallback + safe tools + structured handoff (Python).

Justifies the patch release alongside C++ handoffkit::core packaging and the
matching JS/Rust demos. No network required.
"""

from __future__ import annotations

from typing import Any

from handoffkit import Agent, HandoffProtocol, Team, __version__
from handoffkit.providers.echo_provider import EchoProvider
from handoffkit.providers.fallback import FallbackProvider
from handoffkit.tools import extract_keywords, summarize_text


class _FailingProvider:
    """Primary that always fails so fallback is exercised."""

    model = "primary-fail"

    def generate(self, prompt: str, **kwargs: Any) -> str:
        raise RuntimeError("primary down (demo)")


def main() -> None:
    print(f"handoffkit {__version__} — core_runtime_safety_demo (Python)")
    print("theme: FallbackProvider + offline text tools + hybrid_state handoff\n")

    # 1) Fallback: fail primary → echo secondary
    fb = FallbackProvider(
        [_FailingProvider(), EchoProvider(model="secondary-echo")],
        model="fallback-chain",
    )
    answer = fb.generate("Ship a minimal offline multi-agent handoff.")
    assert "EchoProvider" in answer or "Summary" in answer
    print("[fallback] secondary echo OK")
    print(answer[:240].rstrip() + ("...\n" if len(answer) > 240 else "\n"))

    # 2) Offline text tools (not shell / not run_command)
    summary = summarize_text(
        "HandoffKit ships installable C++ core plus Python and JS parity demos."
    )
    keys = extract_keywords(summary)
    print(f"[tools] summarize_text chars={len(summary)}")
    print(f"[tools] extract_keywords sample={keys[:5]}")

    # 3) Tiny dual-agent team with structured protocol
    protocol = HandoffProtocol(mode="hybrid_state")
    team = Team(
        agents=[
            Agent(
                name="Architect",
                role="Plan offline-safe multi-runtime handoffs.",
                provider=EchoProvider(model="arch"),
            ),
            Agent(
                name="Coder",
                role="Implement installable core surfaces.",
                provider=EchoProvider(model="coder"),
            ),
        ],
        protocol=protocol,
    )
    result = team.run("Document handoffkit::core install for C++ and parity demos for Python/JS.")
    print(f"[team] handoffs={len(result.handoffs)} final_output_chars={len(result.final_output)}")
    print("\ncore_runtime_safety_demo OK")


if __name__ == "__main__":
    main()

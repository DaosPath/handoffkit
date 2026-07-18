"""Educational diagnostic-orchestrator showcase.

This is a synthetic workflow demo. It is not medical advice and does not produce
patient-specific diagnosis or treatment.
"""

from __future__ import annotations

from handoffkit import run_showcase

if __name__ == "__main__":
    result = run_showcase("doctor-orchestrator")
    print(result.to_markdown())

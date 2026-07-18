"""Project template scaffolding demo."""

from __future__ import annotations

import tempfile
from pathlib import Path

from handoffkit import TemplateScaffolder


def main() -> None:
    """Scaffold a small project from a built-in template."""
    output_dir = Path(tempfile.gettempdir()) / "handoffkit-template-demo"
    scaffolder = TemplateScaffolder()
    result = scaffolder.scaffold(
        "calculator-agent",
        template="basic-agent",
        output=output_dir,
        force=True,
    )
    print(result.to_markdown())


if __name__ == "__main__":
    main()

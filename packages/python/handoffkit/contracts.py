"""Cross-runtime contract inventory helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_FIXTURES = [
    "handoff_state.json",
    "run_trace.json",
    "validation_report.json",
    "quality_report.json",
    "tool_call.json",
    "tool_result.json",
    "provider_tool_schema.json",
]

DEFAULT_SCHEMAS = [
    "handoff-state.schema.json",
    "run-trace.schema.json",
    "validation-report.schema.json",
    "quality-report.schema.json",
    "tool-call.schema.json",
    "tool-result.schema.json",
    "provider-tool-schema.schema.json",
]


@dataclass
class ContractParityReport:
    """Summary of shared contract coverage for one runtime."""

    runtime: str
    version: str
    success: bool
    fixture_count: int
    schema_count: int
    supported_contracts: list[str] = field(default_factory=list)
    missing_fixtures: list[str] = field(default_factory=list)
    missing_schemas: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize this report."""
        return {
            "runtime": self.runtime,
            "version": self.version,
            "success": self.success,
            "fixture_count": self.fixture_count,
            "schema_count": self.schema_count,
            "supported_contracts": self.supported_contracts,
            "missing_fixtures": self.missing_fixtures,
            "missing_schemas": self.missing_schemas,
            "metadata": self.metadata,
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize this report as JSON."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def to_markdown(self) -> str:
        """Serialize this report as Markdown."""
        contracts = "\n".join(f"- `{name}`" for name in self.supported_contracts) or "- none"
        missing_fixtures = "\n".join(f"- `{name}`" for name in self.missing_fixtures) or "- none"
        missing_schemas = "\n".join(f"- `{name}`" for name in self.missing_schemas) or "- none"
        return (
            "# Contract Parity Report\n\n"
            f"Runtime: `{self.runtime}`\n\n"
            f"Version: `{self.version}`\n\n"
            f"Success: `{self.success}`\n\n"
            f"Fixtures: `{self.fixture_count}`\n\n"
            f"Schemas: `{self.schema_count}`\n\n"
            f"## Supported Contracts\n\n{contracts}\n\n"
            f"## Missing Fixtures\n\n{missing_fixtures}\n\n"
            f"## Missing Schemas\n\n{missing_schemas}\n"
        )


def build_contract_parity_report(
    *,
    runtime: str,
    version: str,
    contracts_root: str | Path | None = None,
    expected_fixtures: list[str] | None = None,
    expected_schemas: list[str] | None = None,
) -> ContractParityReport:
    """Build a deterministic report for the shared contract folder."""
    root = Path(contracts_root) if contracts_root is not None else _default_contracts_root()
    fixtures = expected_fixtures or DEFAULT_FIXTURES
    schemas = expected_schemas or DEFAULT_SCHEMAS
    missing_fixtures = [
        name for name in fixtures if not (root / "fixtures" / name).exists()
    ]
    missing_schemas = [name for name in schemas if not (root / "schemas" / name).exists()]
    supported = [
        name.removesuffix(".json")
        for name in fixtures
        if name not in missing_fixtures
    ]
    return ContractParityReport(
        runtime=runtime,
        version=version,
        success=not missing_fixtures and not missing_schemas,
        fixture_count=len(fixtures) - len(missing_fixtures),
        schema_count=len(schemas) - len(missing_schemas),
        supported_contracts=supported,
        missing_fixtures=missing_fixtures,
        missing_schemas=missing_schemas,
        metadata={"contracts_root": str(root)},
    )


def _default_contracts_root() -> Path:
    return Path(__file__).resolve().parents[2] / "contracts"

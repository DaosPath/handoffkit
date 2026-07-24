"""Tests for documented public API stability candidates."""

from __future__ import annotations


def test_stable_api_candidates_import_from_public_namespace() -> None:
    from handoffkit import (  # noqa: PLC0415
        Agent,
        HandoffProtocol,
        HandoffQualityReport,
        HandoffState,
        MediaWorkflowReport,
        ProviderToolAdapter,
        Recipe,
        RecipeRunner,
        RecipeRunResult,
        RecipeStep,
        ReplayRunner,
        RunTrace,
        Team,
        Tool,
        ToolCall,
        ToolRegistry,
        ToolResult,
        ValidationReport,
    )

    assert Agent.__name__ == "Agent"
    assert Team.__name__ == "Team"
    assert HandoffState.__name__ == "HandoffState"
    assert HandoffProtocol.__name__ == "HandoffProtocol"
    assert MediaWorkflowReport.__name__ == "MediaWorkflowReport"
    assert Tool.__name__ == "Tool"
    assert ToolCall.__name__ == "ToolCall"
    assert ToolResult.__name__ == "ToolResult"
    assert ToolRegistry.__name__ == "ToolRegistry"
    assert Recipe.__name__ == "Recipe"
    assert RecipeStep.__name__ == "RecipeStep"
    assert RecipeRunner.__name__ == "RecipeRunner"
    assert RecipeRunResult.__name__ == "RecipeRunResult"
    assert ValidationReport.__name__ == "ValidationReport"
    assert HandoffQualityReport.__name__ == "HandoffQualityReport"
    assert ProviderToolAdapter.__name__ == "ProviderToolAdapter"
    assert RunTrace.__name__ == "RunTrace"
    assert ReplayRunner.__name__ == "ReplayRunner"


def test_new_public_helpers_import_from_public_namespace() -> None:
    from handoffkit import (  # noqa: PLC0415
        FileTraceStore,
        ReplaySummary,
        ShowcaseResult,
        TraceEvent,
        TraceStep,
        build_showcase,
        load_report_json,
        run_showcase,
        showcase_names,
        write_report_files,
    )

    assert FileTraceStore.__name__ == "FileTraceStore"
    assert ReplaySummary.__name__ == "ReplaySummary"
    assert ShowcaseResult.__name__ == "ShowcaseResult"
    assert TraceEvent.__name__ == "TraceEvent"
    assert TraceStep.__name__ == "TraceStep"
    assert callable(build_showcase)
    assert callable(load_report_json)
    assert callable(run_showcase)
    assert callable(showcase_names)
    assert callable(write_report_files)


def test_version_is_188() -> None:
    from handoffkit import __version__  # noqa: PLC0415

    assert __version__ == "1.14.2"

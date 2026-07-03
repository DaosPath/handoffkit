import pytest

from handoffkit.cli import (
    evaluate_report,
    init_project,
    main,
    run_async_demo,
    run_demo,
    run_extension_demo,
    run_provider_formats_demo,
    run_provider_tools_demo,
    run_quality_demo,
    run_recipe_demo,
    run_structured_demo,
    run_validators_demo,
)


def test_cli_help_when_no_command(capsys) -> None:  # type: ignore[no-untyped-def]
    exit_code = main([])

    captured = capsys.readouterr()

    assert exit_code == 0
    assert "usage:" in captured.out
    assert "demo" in captured.out


def test_cli_version(capsys) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(SystemExit) as exc_info:
        main(["--version"])

    captured = capsys.readouterr()

    assert exc_info.value.code == 0
    assert "handoffkit 1.0.0" in captured.out


def test_run_demo_reports_handoff_count() -> None:
    output = run_demo()

    assert "HandoffKit demo" in output
    assert "Handoffs: 2" in output


def test_run_async_demo_reports_handoff_count() -> None:
    output = run_async_demo()

    assert "HandoffKit async demo" in output
    assert "Handoffs: 1" in output


def test_run_recipe_demo_reports_recipe() -> None:
    output = run_recipe_demo()

    assert "Recipe Run: plan-execute-review" in output


def test_run_extension_demo_reports_extension() -> None:
    output = run_extension_demo()

    assert "HandoffKit extension demo" in output
    assert "demo" in output


def test_run_structured_demo_reports_structured_output() -> None:
    output = run_structured_demo()

    assert "Structured Output: TaskSummary" in output
    assert "Success" in output


def test_run_provider_tools_demo_reports_tool_result() -> None:
    output = run_provider_tools_demo()

    assert "provider tool adapter demo" in output
    assert "label:demo" in output



def test_run_quality_demo_reports_score() -> None:
    output = run_quality_demo()

    assert "Handoff Quality Report" in output
    assert "Score" in output


def test_run_validators_demo_reports_contracts() -> None:
    output = run_validators_demo()

    assert "contract validators demo" in output
    assert "HandoffState: True" in output
    assert "StructuredOutput: True" in output
    assert "ToolSchema: True" in output


def test_run_provider_formats_demo_reports_provider_shapes() -> None:
    output = run_provider_formats_demo()

    assert "provider tool formats demo" in output
    assert "OpenAI schema type: function" in output
    assert "Anthropic call: add" in output


def test_new_cli_commands_run(capsys) -> None:  # type: ignore[no-untyped-def]
    for command in ["demo-async", "demo-quality", "demo-validators", "demo-provider-formats"]:
        exit_code = main([command])
        captured = capsys.readouterr()
        assert exit_code == 0
        assert "HandoffKit" in captured.out


def test_evaluate_report_command(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "trace.json"
    path.write_text(
        (
            '{"run_id":"demo","name":"demo","success":true,'
            '"final_output":"done","steps":[{"name":"step","success":true}],'
            '"handoffs":[],"metadata":{}}'
        ),
        encoding="utf-8",
    )

    output = evaluate_report(str(path))

    assert "Workflow Evaluation Report" in output


def test_init_project_command(tmp_path) -> None:  # type: ignore[no-untyped-def]
    output = init_project("demo-agent", template="basic-agent", output=str(tmp_path))

    assert "Scaffold Result" in output
    assert (tmp_path / "demo-agent" / "main.py").exists()

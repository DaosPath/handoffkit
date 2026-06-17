import pytest

from handoffkit.cli import main, run_demo, run_extension_demo, run_recipe_demo


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
    assert "handoffkit 0.5.0" in captured.out


def test_run_demo_reports_handoff_count() -> None:
    output = run_demo()

    assert "HandoffKit demo" in output
    assert "Handoffs: 2" in output


def test_run_recipe_demo_reports_recipe() -> None:
    output = run_recipe_demo()

    assert "Recipe Run: plan-execute-review" in output


def test_run_extension_demo_reports_extension() -> None:
    output = run_extension_demo()

    assert "HandoffKit extension demo" in output
    assert "demo" in output

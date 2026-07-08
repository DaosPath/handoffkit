import pytest

from handoffkit.cli import (
    evaluate_report,
    init_project,
    list_provider_models,
    list_providers,
    list_showcases,
    main,
    probe_provider_models,
    render_report,
    run_async_demo,
    run_coding_review_demo,
    run_demo,
    run_doctor_benchmark_demo,
    run_doctor_orchestrator_demo,
    run_extension_demo,
    run_fusion_style_demo,
    run_mai_style_doctor_benchmark_demo,
    run_media_demo,
    run_named_showcase,
    run_provider_formats_demo,
    run_provider_tools_demo,
    run_quality_demo,
    run_recipe_demo,
    run_research_workflow_demo,
    run_structured_demo,
    run_support_escalation_demo,
    run_validators_demo,
    select_provider_model,
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
    assert "handoffkit 1.7.0" in captured.out


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


def test_run_fusion_style_demo_writes_report(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    output = run_fusion_style_demo()

    assert "Fusion-style panel demo" in output
    assert "offline-deterministic-panel" in output
    assert (tmp_path / "reports" / "fusion_style_demo.json").exists()
    assert (tmp_path / "reports" / "fusion_style_demo.md").exists()


def test_run_media_demo_writes_report_and_subtitles(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    output = run_media_demo()

    assert "media dubbing demo" in output
    assert "Segments: 3" in output
    assert (tmp_path / "reports" / "media_dubbing_demo.json").exists()
    assert (tmp_path / "examples" / "output" / "media_dubbing_demo" / "subtitles_es.srt").exists()



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


def test_provider_registry_cli_helpers_are_offline() -> None:
    listing = list_providers()
    models = list_provider_models("opencode-go")
    probe = probe_provider_models("opencode-go", models="mimo-v2.5")
    selected = select_provider_model("opencode-go", models="mimo-v2.5", json_output=True)

    assert "opencode-go" in listing
    assert "mimo-v2.5" in models
    assert "provider probe (offline)" in probe
    assert '"model": "mimo-v2.5"' in selected


def test_real_world_cli_demos_write_reports(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    outputs = [
        run_coding_review_demo(),
        run_support_escalation_demo(),
        run_research_workflow_demo(),
        run_doctor_orchestrator_demo(),
    ]

    assert "Architect -> Coder -> Reviewer -> Tester" in outputs[0]
    assert "Triage -> Billing -> Refund -> Supervisor" in outputs[1]
    assert "Researcher -> Extractor -> Fact-checker -> Writer" in outputs[2]
    assert "Doctor Orchestrator" in outputs[3]
    assert (tmp_path / "runs" / "latest" / "report.json").exists()
    assert "Doctor Orchestrator" in render_report(str(tmp_path / "runs" / "latest"))
    assert "HTML report written" in render_report(str(tmp_path / "runs" / "latest"), html=True)
    assert (tmp_path / "runs" / "latest" / "report.html").exists()


def test_showcase_list_and_named_showcase_write_reports(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    listing = list_showcases()
    output = run_named_showcase("coding-review")

    assert "handoffkit showcase coding-review" in listing
    assert "support-escalation" in listing
    assert "Coding Agents" in output
    assert (tmp_path / "runs" / "latest" / "trace.json").exists()
    assert (tmp_path / "runs" / "latest" / "report.md").exists()
    assert (tmp_path / "runs" / "latest" / "report.json").exists()


def test_new_cli_commands_run(capsys) -> None:  # type: ignore[no-untyped-def]
    for command in [
        "demo-async",
        "demo-quality",
        "demo-validators",
        "demo-provider-formats",
        "demos",
        "demo-coding-review",
        "demo-support",
        "demo-research",
        "demo-doctor",
        "demo-fusion",
        "demo-media",
    ]:
        exit_code = main([command])
        captured = capsys.readouterr()
        assert exit_code == 0
        assert captured.out


def test_provider_cli_commands_run_offline(capsys) -> None:  # type: ignore[no-untyped-def]
    commands = [
        ["providers", "list"],
        ["providers", "models", "--provider", "opencode-go"],
        ["providers", "probe", "--provider", "opencode-go", "--models", "mimo-v2.5"],
        [
            "providers",
            "select",
            "--provider",
            "opencode-go",
            "--models",
            "mimo-v2.5,deepseek-v4-flash",
            "--json",
        ],
    ]

    for command in commands:
        exit_code = main(command)
        captured = capsys.readouterr()
        assert exit_code == 0
        assert captured.out


def test_showcase_cli_command_runs(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    exit_code = main(["showcase", "support-escalation"])
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Customer Support" in captured.out
    assert (tmp_path / "runs" / "latest" / "report.json").exists()


def test_media_cli_commands_run(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)
    assert main(["demo-media"]) == 0
    transcript = tmp_path / "examples" / "output" / "media_dubbing_demo" / "transcript_zh.json"
    assert transcript.exists()

    assert main(["media", "inspect", str(transcript)]) == 0
    captured = capsys.readouterr()
    assert "Segments: 3" in captured.out

    assert main(["media", "plan", "demo.mp4", "--from", "zh", "--to", "es"]) == 0
    captured = capsys.readouterr()
    assert "zh -> es" in captured.out


def test_doctor_showcase_cli_command_runs(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    exit_code = main(["showcase", "doctor-orchestrator"])
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Doctor Orchestrator" in captured.out
    assert "not medical advice" in captured.out
    assert (tmp_path / "runs" / "latest" / "report.json").exists()

def test_doctor_benchmark_cli_command_runs(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    output = run_doctor_benchmark_demo(3)
    exit_code = main(["benchmark-doctor", "--cases", "3"])
    captured = capsys.readouterr()

    assert "Doctor Benchmark" in output
    assert "MedCaseReasoning" in output
    assert exit_code == 0
    assert "Doctor Benchmark" in captured.out
    assert (tmp_path / "runs" / "latest" / "report.json").exists()


def test_mai_style_doctor_benchmark_cli_command_runs(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    output = run_mai_style_doctor_benchmark_demo(3)
    exit_code = main(["benchmark-doctor-mai", "--cases", "3"])
    captured = capsys.readouterr()

    assert "MAI-Style Public Doctor Benchmark" in output
    assert "private NEJM SDBench data" in output
    assert exit_code == 0
    assert "MAI-Style Public Doctor Benchmark" in captured.out
    assert (tmp_path / "runs" / "latest" / "report.json").exists()


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


def test_init_project_uses_showcase_template_name_directly(tmp_path) -> None:  # type: ignore[no-untyped-def]
    output = init_project("coding-review", output=str(tmp_path))

    assert "coding-review" in output
    assert "cd coding-review" in output
    assert "python coding_review.py" in output
    assert "handoffkit report runs/latest" in output
    assert (tmp_path / "coding-review" / "coding_review.py").exists()

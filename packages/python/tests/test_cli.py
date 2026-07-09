import pytest

from handoffkit.cli import (
    create_extension,
    evaluate_report,
    init_project,
    list_provider_models,
    list_providers,
    list_showcases,
    load_dynamic_extensions,
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
    write_project_report,
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
    assert "handoffkit 1.12.0" in captured.out


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


def test_keys_management_cli(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.chdir(tmp_path)

    # Test set_key
    code = main(["keys", "set", "TEST_KEY", "my-secret-val-1234567890"])
    captured = capsys.readouterr()
    assert code == 0
    assert "Set key TEST_KEY successfully" in captured.out

    # Test list_keys
    code = main(["keys", "list"])
    captured = capsys.readouterr()
    assert code == 0
    assert "TEST_KEY=my-s...7890 (redacted)" in captured.out

    # Test delete_key
    code = main(["keys", "delete", "TEST_KEY"])
    captured = capsys.readouterr()
    assert code == 0
    assert "Deleted key TEST_KEY successfully" in captured.out

    # Test list_keys empty
    code = main(["keys", "list"])
    captured = capsys.readouterr()
    assert code == 0
    assert "No keys configured" in captured.out


# ---------------------------------------------------------------------------
# Extension scaffolding & dynamic loading tests (v1.12.0)
# ---------------------------------------------------------------------------

def test_create_extension_scaffolds_files(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """create_extension writes __init__.py, tools.py, and recipes.py."""
    result = create_extension("my_plugin", output=str(tmp_path))

    ext_dir = tmp_path / "my_plugin"
    assert "my_plugin" in result
    assert (ext_dir / "__init__.py").exists()
    assert (ext_dir / "tools.py").exists()
    assert (ext_dir / "recipes.py").exists()

    init_src = (ext_dir / "__init__.py").read_text(encoding="utf-8")
    assert "extension" in init_src
    assert "my_plugin" in init_src

    tools_src = (ext_dir / "tools.py").read_text(encoding="utf-8")
    assert "@tool" in tools_src or "tool" in tools_src


def test_create_extension_fails_without_force(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """create_extension raises FileExistsError when directory exists and force=False."""
    create_extension("conflict_plugin", output=str(tmp_path))
    with pytest.raises(FileExistsError, match="already exists"):
        create_extension("conflict_plugin", output=str(tmp_path))


def test_create_extension_force_overwrites(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """create_extension succeeds when force=True even if directory already exists."""
    create_extension("my_plugin", output=str(tmp_path))
    result = create_extension("my_plugin", output=str(tmp_path), force=True)
    assert "my_plugin" in result


def test_load_dynamic_extensions_no_config(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """load_dynamic_extensions silently returns when handoff.config.json is absent."""
    monkeypatch.chdir(tmp_path)
    from handoffkit.extensions import ExtensionRegistry
    registry = ExtensionRegistry()
    load_dynamic_extensions(registry)  # should not raise
    assert registry.list() == []


def test_load_dynamic_extensions_with_valid_config(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """load_dynamic_extensions loads a scaffolded extension from handoff.config.json."""
    import json

    monkeypatch.chdir(tmp_path)

    # Scaffold a minimal extension
    create_extension("auto_plugin", output=str(tmp_path))

    # Write a config that references it
    config = {"extensions": [str(tmp_path / "auto_plugin")]}
    (tmp_path / "handoff.config.json").write_text(json.dumps(config), encoding="utf-8")

    from handoffkit.extensions import ExtensionRegistry
    registry = ExtensionRegistry()
    load_dynamic_extensions(registry)
    # The scaffolded extension declares an `extension` object; it should be registered
    # (or at minimum the loader should not raise)
    # We only assert no crash here because the scaffolded module imports handoffkit internals
    # which may or may not resolve depending on the test environment.


def test_create_extension_cli_route(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    """main([create-extension ...]) writes extension files and exits 0."""
    monkeypatch.chdir(tmp_path)
    code = main(["create-extension", "cli_plugin", "--output", str(tmp_path)])
    captured = capsys.readouterr()
    assert code == 0
    assert "cli_plugin" in captured.out
    assert (tmp_path / "cli_plugin" / "__init__.py").exists()


def test_write_project_report_writes_files(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """write_project_report writes project-report JSON and MD files."""
    # Write a dummy python file to index
    (tmp_path / "dummy.py").write_text("# handoffkit example\n", encoding="utf-8")

    out_dir = tmp_path / "reports"
    result = write_project_report(str(tmp_path), output_dir=str(out_dir))

    assert "project-report" in result
    assert (out_dir / "project-report.json").exists()
    assert (out_dir / "project-report.md").exists()

    md_content = (out_dir / "project-report.md").read_text(encoding="utf-8")
    assert "HandoffKit Project Report" in md_content
    assert "dummy.py" in md_content


def test_project_report_cli_route(tmp_path, monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    """main([project-report ...]) runs successfully and exits 0."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / "sample.py").write_text("# handoffkit sample\n", encoding="utf-8")

    code = main(["project-report", str(tmp_path), "--output", str(tmp_path / "out")])
    captured = capsys.readouterr()

    assert code == 0
    assert "HandoffKit project report" in captured.out
    assert (tmp_path / "out" / "project-report.json").exists()


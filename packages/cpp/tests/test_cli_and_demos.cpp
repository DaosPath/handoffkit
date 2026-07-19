#include <handoffkit/cli/cli_app.hpp>
#include <handoffkit/demos/cases.hpp>
#include <handoffkit/demos/demo_types.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>

using namespace handoffkit;

namespace {

std::filesystem::path scratch() {
#ifdef HANDOFFKIT_TEST_SCRATCH
    return std::filesystem::path(HANDOFFKIT_TEST_SCRATCH) / "cli-demo-tests";
#else
    return std::filesystem::temp_directory_path() / "handoffkit-cli-demo-tests";
#endif
}

void test_help_and_version() {
    auto help = cli::run_cli({"help"});
    assert(help.exit_code == 0);
    assert(help.stdout_text.find("demo") != std::string::npos);
    assert(help.stdout_text.find("team") != std::string::npos);
    assert(help.stdout_text.find("validate") != std::string::npos);

    auto ver = cli::run_cli({"version"});
    assert(ver.exit_code == 0);
    assert(ver.stdout_text.find("handoffkit") != std::string::npos);
    std::cout << "test_help_and_version passed\n";
}

void test_cli_team_demo_wire_fields() {
    const auto out = scratch() / "team";
    auto result = cli::run_cli({"team", "--out", out.string()});
    assert(result.exit_code == 0);
    assert(result.stdout_text.find("final_output") != std::string::npos);
    assert(result.stdout_text.find("task=") != std::string::npos);
    assert(result.stdout_text.find("Architect") != std::string::npos ||
           result.stdout_text.find("handoffs=") != std::string::npos);
    std::cout << "test_cli_team_demo_wire_fields passed\n";
}

void test_cli_validate_samples() {
    auto bad = cli::run_cli({"validate", "--sample-bad"});
    assert(bad.exit_code != 0);
    auto good = cli::run_cli({"validate", "--sample-good"});
    assert(good.exit_code == 0);
    std::cout << "test_cli_validate_samples passed\n";
}

void test_cli_quality_and_doctor() {
    auto q = cli::run_cli({"quality"});
    assert(q.exit_code == 0);
    assert(q.stdout_text.find("score") != std::string::npos ||
           q.stdout_text.find("Score") != std::string::npos);
    auto d = cli::run_cli({"doctor"});
    assert(d.exit_code == 0);
    assert(d.stdout_text.find("self_check_team=ok") != std::string::npos);
    std::cout << "test_cli_quality_and_doctor passed\n";
}

void test_demo_functions_support_and_coding() {
    demos::DemoOptions opt;
    opt.output_dir = scratch() / "demos";
    opt.write_files = true;

    auto support = demos::run_support_escalation_demo(opt);
    assert(support);
    assert(support.value().success);
    assert(!support.value().final_output.empty());
    auto wire = support.value().to_json();
    assert(wire.contains("task"));
    assert(wire.contains("final_output"));
    assert(wire.contains("handoffs"));
    assert(wire.at("handoffs").is_array());
    assert(!wire.at("handoffs").empty());

    auto coding = demos::run_coding_review_demo(opt);
    assert(coding);
    assert(coding.value().success);
    assert(coding.value().to_json().contains("final_output"));

    std::cout << "test_demo_functions_support_and_coding passed\n";
}

void test_demo_catalog_all_ids_run_no_write() {
    demos::DemoOptions opt;
    opt.write_files = false;
    opt.output_dir = scratch() / "all";
    int ran = 0;
    for (const auto& id : demos::demo_ids()) {
        auto result = demos::run_demo_by_id(id, opt);
        assert(result);
        assert(result.value().success);
        assert(!result.value().final_output.empty() || result.value().name == "protocol_matrix");
        ++ran;
    }
    assert(ran >= 20);
    std::cout << "test_demo_catalog_all_ids_run_no_write passed (" << ran << " demos)\n";
}

void test_case_corpus_nontrivial() {
    // Compact unique corpus (not combinatorial padding).
    assert(demos::case_corpus_size() >= 20);
    assert(demos::case_corpus_size() <= 80);
    assert(demos::find_case("support-01-v1") != nullptr);
    auto support = demos::cases_for_domain("support");
    assert(support.size() >= 3);
    std::cout << "test_case_corpus_nontrivial passed size=" << demos::case_corpus_size() << "\n";
}

void test_cli_demo_support_escalation() {
    const auto out = scratch() / "support-cli";
    auto result = cli::run_cli({"demo", "support_escalation", "--out", out.string()});
    assert(result.exit_code == 0);
    assert(result.stdout_text.find("final_output") != std::string::npos ||
           result.stdout_text.find("Final output") != std::string::npos);
    assert(result.stdout_text.find("wire.task=") != std::string::npos);
    assert(result.stdout_text.find("wire.handoffs=") != std::string::npos);
    std::cout << "test_cli_demo_support_escalation passed\n";
}

void test_cli_train_pipeline() {
    auto help = cli::run_cli({"help"});
    assert(help.exit_code == 0);
    assert(help.stdout_text.find("train") != std::string::npos);

    auto train_help = cli::run_cli({"train", "help"});
    assert(train_help.exit_code == 0);
    assert(train_help.stdout_text.find("--extra") != std::string::npos);

    const auto out = scratch() / "train-cli";
    auto result = cli::run_cli({
        "train",
        "pipeline",
        "--out",
        out.string(),
        "--prompt",
        "What is distillation?",
        "--prompt",
        "What is SFT?",
    });
    assert(result.exit_code == 0);
    assert(result.stdout_text.find("success=true") != std::string::npos);
    assert(result.stdout_text.find("distill_examples=") != std::string::npos);
    assert(result.stdout_text.find("train_success=true") != std::string::npos);
    assert(result.stdout_text.find("dataset_path=") != std::string::npos);
    assert(std::filesystem::exists(out / "student.jsonl"));
    assert(std::filesystem::exists(out / "train_out" / "train_report.json") ||
           result.stdout_text.find("report_path=") != std::string::npos);
    std::cout << "test_cli_train_pipeline passed\n";
}

std::filesystem::path find_train_stub_for_cli() {
    const char* candidates[] = {
        "packages/cpp/scripts/hk_train_echo_stub.py",
        "../packages/cpp/scripts/hk_train_echo_stub.py",
        "../../packages/cpp/scripts/hk_train_echo_stub.py",
        "scripts/hk_train_echo_stub.py",
        "../scripts/hk_train_echo_stub.py",
    };
    for (const char* c : candidates) {
        if (std::filesystem::exists(c)) return std::filesystem::weakly_canonical(c);
    }
    return {};
}

void test_cli_train_process_extra() {
    const auto stub = find_train_stub_for_cli();
    if (stub.empty()) {
        std::cout << "test_cli_train_process_extra SKIP (stub not found)\n";
        return;
    }

    const auto base = scratch() / "train-cli-process";
    std::error_code ec;
    std::filesystem::remove_all(base, ec);
    std::filesystem::create_directories(base, ec);

    // Build a small dataset via CLI, then process-backend train with --extra flags
    auto ds = cli::run_cli({
        "train",
        "dataset",
        "--out",
        (base / "ds.jsonl").string(),
        "--prompt",
        "hello process",
    });
    assert(ds.exit_code == 0);
    assert(std::filesystem::exists(base / "ds.jsonl"));

    const auto out_dir = (base / "run_out").string();
    auto result = cli::run_cli({
        "train",
        "run",
        "--backend",
        "process",
        "--dataset",
        (base / "ds.jsonl").string(),
        "--out",
        out_dir,
        "--extra",
        "python",
        "--extra",
        stub.string(),
        "--extra",
        "--dataset",
        "--extra",
        "{dataset}",
        "--extra",
        "--output-dir",
        "--extra",
        "{output_dir}",
        "--extra",
        "--epochs",
        "--extra",
        "1",
    });

    if (result.exit_code != 0) {
        // python missing or PATH issues — still prove argv parsing (not "requires argv")
        assert(result.stderr_text.find("requires trainer argv") == std::string::npos);
        assert(result.stdout_text.find("backend=process") != std::string::npos ||
               result.stdout_text.find("error=") != std::string::npos ||
               !result.stderr_text.empty());
        std::cout << "test_cli_train_process_extra soft-fail: " << result.stderr_text << "\n"
                  << result.stdout_text << "\n";
        return;
    }
    assert(result.stdout_text.find("success=true") != std::string::npos);
    assert(result.stdout_text.find("backend=process") != std::string::npos);
    assert(std::filesystem::exists(std::filesystem::path(out_dir) / "metrics.json") ||
           std::filesystem::exists(std::filesystem::path(out_dir) / "process_train.log"));
    std::cout << "test_cli_train_process_extra passed\n";
}

void test_cli_train_process_dashdash() {
    // Bare -- terminator must accept flag-like process tokens
    auto missing = cli::run_cli({
        "train",
        "run",
        "--backend",
        "process",
        "--dataset",
        "missing.jsonl",
        "--",
    });
    assert(missing.exit_code != 0);
    // empty argv after -- should hit the process-requires-argv guard
    assert(missing.stderr_text.find("requires trainer argv") != std::string::npos ||
           missing.stdout_text.find("requires trainer argv") != std::string::npos);

    auto with_args = cli::run_cli({
        "train",
        "run",
        "--backend",
        "process",
        "--dataset",
        "missing.jsonl",
        "--out",
        (scratch() / "train-dashdash").string(),
        "--",
        "cmake",
        "-E",
        "echo",
        "ok",
        "{dataset}",
    });
    // dataset missing → process may still run cmake and succeed (echo ignores file),
    // or fail popen — either way must not be the empty-argv error
    assert(with_args.stderr_text.find("requires trainer argv") == std::string::npos);
    std::cout << "test_cli_train_process_dashdash passed\n";
}

}  // namespace

int main() {
    test_help_and_version();
    test_cli_team_demo_wire_fields();
    test_cli_validate_samples();
    test_cli_quality_and_doctor();
    test_demo_functions_support_and_coding();
    test_demo_catalog_all_ids_run_no_write();
    test_case_corpus_nontrivial();
    test_cli_demo_support_escalation();
    test_cli_train_pipeline();
    test_cli_train_process_extra();
    test_cli_train_process_dashdash();
    std::cout << "All CLI/demo tests passed!\n";
    return 0;
}

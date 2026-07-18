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
    std::cout << "All CLI/demo tests passed!\n";
    return 0;
}

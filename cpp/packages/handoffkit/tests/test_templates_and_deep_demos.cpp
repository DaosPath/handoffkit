#include <handoffkit/cli/cli_app.hpp>
#include <handoffkit/demos/cases.hpp>
#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/workflows/templates.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>
#include <unordered_set>

using namespace handoffkit;

namespace {

std::filesystem::path scratch() {
#ifdef HANDOFFKIT_TEST_SCRATCH
    return std::filesystem::path(HANDOFFKIT_TEST_SCRATCH) / "deep-demos";
#else
    return std::filesystem::temp_directory_path() / "handoffkit-deep-demos";
#endif
}

void test_compact_unique_corpus() {
    // Must remain unique (no combinatorial explosion).
    assert(demos::case_corpus_size() >= 20);
    assert(demos::case_corpus_size() <= 80);
    std::unordered_set<std::string> ids;
    std::unordered_set<std::string> titles;
    for (const auto& c : demos::case_corpus()) {
        assert(ids.insert(c.id).second);  // unique ids
        titles.insert(c.title);
        assert(!c.task.empty());
        assert(!c.domain.empty());
    }
    // Most titles should be unique (not 8x variants of same title)
    assert(titles.size() + 5 >= ids.size());  // allow tiny overlap only
    assert(demos::find_case("support-01-v1") != nullptr);
    assert(demos::find_case("ops-01-v1") != nullptr);
    std::cout << "test_compact_unique_corpus passed size=" << demos::case_corpus_size()
              << " unique_titles=" << titles.size() << "\n";
}

void test_all_templates_listed_and_runnable_via_cli() {
    auto ids = templates::template_ids();
    assert(ids.size() >= 10);
    assert(templates::find_template("support_escalation") != nullptr);
    auto list = cli::run_cli({"templates", "list"});
    assert(list.exit_code == 0);
    assert(list.stdout_text.find("support_escalation") != std::string::npos);

    auto run = cli::run_cli({"templates", "coding_review", "--out", (scratch() / "tpl").string()});
    assert(run.exit_code == 0);
    assert(run.stdout_text.find("final_output") != std::string::npos ||
           run.stdout_text.find("task") != std::string::npos);
    std::cout << "test_all_templates_listed_and_runnable_via_cli passed\n";
}

void test_deep_demos_offline() {
    demos::DemoOptions opt;
    opt.output_dir = scratch() / "deep";
    opt.write_files = false;

    const char* deep_ids[] = {
        "orchestrator_support",
        "orchestrator_coding",
        "eval_harness",
        "structured_outputs",
        "corpus_domain_sweep",
        "text_metrics",
        "multi_orchestrator_compare",
        "template_gallery",
    };
    for (const char* id : deep_ids) {
        auto result = demos::run_demo_by_id(id, opt);
        assert(result);
        assert(result.value().success);
        auto wire = result.value().to_json();
        assert(wire.contains("task"));
        assert(wire.contains("final_output"));
        assert(!wire.at("final_output").get<std::string>().empty());
        std::cout << "  deep demo ok: " << id << "\n";
    }
    std::cout << "test_deep_demos_offline passed\n";
}

void test_cli_evaluate_and_doctor_extended() {
    auto eval = cli::run_cli({"evaluate"});
    assert(eval.exit_code == 0);
    assert(eval.stdout_text.find("Workflow Evaluation") != std::string::npos ||
           eval.stdout_text.find("Score") != std::string::npos);

    auto doctor = cli::run_cli({"doctor"});
    assert(doctor.exit_code == 0);
    assert(doctor.stdout_text.find("templates=") != std::string::npos);
    assert(doctor.stdout_text.find("orchestrator_plans=") != std::string::npos);
    std::cout << "test_cli_evaluate_and_doctor_extended passed\n";
}

void test_full_demo_catalog_still_runs() {
    demos::DemoOptions opt;
    opt.write_files = false;
    int n = 0;
    for (const auto& id : demos::demo_ids()) {
        auto r = demos::run_demo_by_id(id, opt);
        assert(r);
        assert(r.value().success);
        ++n;
    }
    assert(n >= 30);
    std::cout << "test_full_demo_catalog_still_runs passed count=" << n << "\n";
}

}  // namespace

int main() {
    test_compact_unique_corpus();
    test_all_templates_listed_and_runnable_via_cli();
    test_deep_demos_offline();
    test_cli_evaluate_and_doctor_extended();
    test_full_demo_catalog_still_runs();
    std::cout << "All templates/deep demo tests passed\n";
    return 0;
}

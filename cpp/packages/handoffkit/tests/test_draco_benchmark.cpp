#include <handoffkit/cli/cli_app.hpp>
#include <handoffkit/demos/fusion/draco.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

using namespace handoffkit;
using namespace handoffkit::demos::fusion;

namespace {

std::filesystem::path make_fixture(const std::filesystem::path& root) {
    std::filesystem::create_directories(root);
    const auto path = root / "draco_fixture.jsonl";
    nlohmann::json rubric = {
        {"sections", nlohmann::json::array({
            {
                {"id", "quality"},
                {"title", "Answer quality"},
                {"criteria", nlohmann::json::array({
                    {{"id", "c1"}, {"weight", 10}, {"requirement", "States the direct answer."}},
                    {{"id", "c2"}, {"weight", 5}, {"requirement", "Explains the tradeoff."}},
                    {{"id", "c3"}, {"weight", -3}, {"requirement", "Contains a fabricated citation."}},
                })},
            },
        })},
    };
    nlohmann::json row = {
        {"id", "fixture-001"},
        {"domain", "Testing"},
        {"problem", "Compare two deterministic test strategies and provide a direct recommendation with tradeoffs."},
        {"answer", rubric.dump()},
    };
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    assert(out);
    out << row.dump() << "\n";
    return path;
}

void test_loader_and_scoring(const std::filesystem::path& dataset) {
    auto tasks = load_draco_tasks(dataset);
    assert(tasks);
    assert(tasks.value().size() == 1);
    assert(tasks.value()[0].id == "fixture-001");
    assert(tasks.value()[0].domain == "Testing");
    assert(tasks.value()[0].criteria.size() == 3);
    assert(tasks.value()[0].criteria[2].weight == -3.0);

    const std::unordered_map<std::string, std::string> verdicts = {
        {"c1", "MET"},
        {"c2", "UNMET"},
        {"c3", "MET"},
    };
    const auto score = score_draco_verdicts(tasks.value()[0].criteria, verdicts);
    assert(score.raw_score == 7.0);
    assert(score.positive_weight_sum == 15.0);
    assert(std::abs(score.normalized_score_pct - 46.6667) < 0.0001);
    assert(score.n_judged == 3);
    assert(score.n_missing == 0);
    assert(score.met_positive == 1);
    assert(score.unmet_positive == 1);
    assert(score.met_negative_penalties == 1);
    std::cout << "test_loader_and_scoring ok\n";
}

void test_native_baseline_and_resume(
    const std::filesystem::path& dataset,
    const std::filesystem::path& output
) {
    DracoRunConfig config;
    config.dataset_path = dataset;
    config.output_dir = output;
    config.provider = "echo";
    config.model = "draco-echo";
    config.tier = "baseline";
    config.offset = 0;
    config.limit = 1;
    config.resume = true;
    config.judge_answers = false;
    config.generation_attempts = 1;

    auto first = run_draco_batch(config);
    assert(first);
    assert(first.value().selected_tasks == 1);
    assert(first.value().generated_tasks == 1);
    assert(first.value().judged_tasks == 0);
    assert(first.value().failed_tasks == 0);
    assert(first.value().tasks.size() == 1);
    assert(first.value().tasks[0].answer_chars > 0);
    assert(!first.value().tasks[0].resumed_generation);
    assert(std::filesystem::is_regular_file(output / "manifest.json"));
    assert(std::filesystem::is_regular_file(output / "summary.json"));
    assert(std::filesystem::is_regular_file(output / "summary.md"));

    auto second = run_draco_batch(config);
    assert(second);
    assert(second.value().tasks.size() == 1);
    assert(second.value().tasks[0].resumed_generation);
    assert(second.value().tasks[0].answer_chars == first.value().tasks[0].answer_chars);

    config.model = "different-echo-model";
    auto mismatch = run_draco_batch(config);
    assert(!mismatch);
    assert(mismatch.error().message.find("resume refused") != std::string::npos);
    std::cout << "test_native_baseline_and_resume ok\n";
}

void test_cli_validate(const std::filesystem::path& dataset) {
    const auto result = cli::run_cli({
        "benchmark", "draco", "validate", "--dataset", dataset.string(),
    });
    assert(result.exit_code == 0);
    assert(result.stdout_text.find("benchmark=draco") != std::string::npos);
    assert(result.stdout_text.find("tasks=1") != std::string::npos);
    assert(result.stdout_text.find("criteria=3") != std::string::npos);

    const auto names = cli::command_names();
    assert(std::find(names.begin(), names.end(), "benchmark") != names.end());
    std::cout << "test_cli_validate ok\n";
}

}  // namespace

int main() {
    const auto root = std::filesystem::temp_directory_path() / "handoffkit_draco_native_test";
    std::error_code ec;
    std::filesystem::remove_all(root, ec);
    const auto dataset = make_fixture(root);
    test_loader_and_scoring(dataset);
    test_native_baseline_and_resume(dataset, root / "run");
    test_cli_validate(dataset);
    std::filesystem::remove_all(root, ec);
    std::cout << "All native DRACO benchmark tests passed\n";
    return 0;
}

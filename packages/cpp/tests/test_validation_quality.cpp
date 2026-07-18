#include <handoffkit/handoffkit.hpp>

#include <cassert>
#include <iostream>

using namespace handoffkit;

namespace {

void test_validator_pass_and_fail() {
    HandoffStateValidator validator;

    HandoffState good;
    good.task = "Ship runtime";
    good.from_agent = "A";
    good.to_agent = "B";
    good.summary = "Enough words here for clarity scoring later.";
    auto pass = validator.validate(good);
    assert(pass.success);

    HandoffState bad;
    bad.task = "";
    bad.from_agent = "";
    bad.to_agent = "B";
    auto fail = validator.validate(bad);
    assert(!fail.success);
    assert(!fail.issues.empty());
    bool saw_task = false;
    for (const auto& issue : fail.issues) {
        if (issue.field == "task" && issue.severity == "error") {
            saw_task = true;
        }
    }
    assert(saw_task);
    std::cout << "test_validator_pass_and_fail passed!" << std::endl;
}

void test_tool_schema_validator_fixture() {
    ProviderToolSchema schema;
    schema.name = "add";
    schema.description = "Add two numbers.";
    schema.parameters = nlohmann::json{
        {"type", "object"},
        {"properties", {{"a", {{"type", "integer"}}}, {"b", {{"type", "integer"}}}}},
        {"required", nlohmann::json::array({"a", "b"})},
    };

    ToolSchemaValidator validator;
    auto ok = validator.validate(schema.to_json());
    assert(ok.success);

    auto bad = validator.validate(nlohmann::json{{"description", "x"}});
    assert(!bad.success);
    std::cout << "test_tool_schema_validator_fixture passed!" << std::endl;
}

void test_quality_evaluator_good_and_poor() {
    HandoffQualityEvaluator evaluator(0.6);

    HandoffState rich;
    rich.task = "Implement calculator";
    rich.from_agent = "Architect";
    rich.to_agent = "Coder";
    rich.summary = "Use a small command parser and keep math operations pure with tests.";
    rich.decisions = {"Use argparse-style commands", "Keep pure functions"};
    rich.important_files = {"calculator.py", "tests/test_calculator.py"};
    rich.errors = {"Divide-by-zero must error clearly"};
    rich.next_steps = {"Implement calculator.py", "Run pytest -q"};
    rich.context_refs = {"README.md#quickstart"};

    auto good = evaluator.evaluate(rich);
    assert(good.metrics.size() == 5);
    assert(!good.grade.empty());
    assert(good.score > 0.0);
    // Strong handoff should pass validation and score reasonably.
    assert(good.validation.success);

    HandoffState poor;
    poor.task = "x";
    poor.from_agent = "a";
    poor.to_agent = "b";
    poor.summary = "no";
    auto weak = evaluator.evaluate(poor);
    assert(weak.score < good.score);
    assert(!weak.recommendations.empty() || !weak.validation.success || weak.score < 0.75);

    auto empty = evaluator.evaluate_many({});
    assert(!empty.success);
    assert(empty.grade == "F");

    std::cout << "test_quality_evaluator_good_and_poor passed! good=" << good.score
              << " weak=" << weak.score << std::endl;
}

}  // namespace

int main() {
    test_validator_pass_and_fail();
    test_tool_schema_validator_fixture();
    test_quality_evaluator_good_and_poor();
    std::cout << "All validation/quality tests passed!" << std::endl;
    return 0;
}
